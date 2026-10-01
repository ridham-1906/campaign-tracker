import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, Client, User, Vendor, VendorReminder } from "@/models";
import { createTransport, sendMailWith } from "@/lib/mailer";
import { buildVendorReminder, type VendorLocation } from "@/lib/mail/vendor-reminder";
import {
  buildVendorMonitoringReminder,
  type MonitoringLocation,
} from "@/lib/mail/vendor-monitoring-reminder";
import { businessToday, daysUntil, lifecycleState } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";
import type { VendorReminderKind } from "@/models/vendor-reminder";

/**
 * Vendor photo requests. Each campaign carries three date lists —
 * `vendorReminderDates.installation / mid_date / end_date` — set from
 * "Remind vendor…" on the campaigns screen. On each of those dates the hourly
 * cron asks that campaign's vendors for that stage's photo: one email per
 * vendor, listing just its own sites that don't have that photo yet for the
 * current term. A vendor with no email, or with nothing missing, is skipped.
 *
 * Installation and mid-date only ask about sites that are still live; the
 * closing photo is asked whatever the status, since it's wanted *after* the run.
 *
 * `VendorReminder` rows log each send per (vendor, campaign, day, kind), and
 * the cron skips any vendor already logged for that day — so the hourly
 * repeats retry failures without double-sending.
 */

type VendorRef = { _id: Types.ObjectId; name: string; emails: string[] };

export type VendorStage = "installation" | "mid_date" | "end_date";
export const VENDOR_STAGES: VendorStage[] = ["installation", "mid_date", "end_date"];

type LocationInput = {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  city: string;
  location: string;
  medium?: string | null;
  status: string;
  startDate: Date;
  midDate: Date | null;
  endDate: Date;
};

const isLive = (l: LocationInput, now: Date) =>
  lifecycleState({ status: l.status, endDate: new Date(l.endDate) }, now) === "LIVE";

function toVendorLocation(l: LocationInput, now: Date): VendorLocation {
  return {
    location: l.location,
    city: l.city,
    medium: l.medium ?? "",
    startDate: new Date(l.startDate),
    endDate: new Date(l.endDate),
    daysLeft: Math.max(0, daysUntil(new Date(l.endDate), now)),
  };
}

function toMonitoringLocation(l: LocationInput): MonitoringLocation {
  return {
    location: l.location,
    startDate: new Date(l.startDate),
    midDate: l.midDate ? new Date(l.midDate) : null,
    endDate: new Date(l.endDate),
  };
}

/** Which of `locations` still need `kind`'s email right now. */
async function qualifyingLocations(
  kind: VendorReminderKind,
  locations: LocationInput[],
  term: number,
  now: Date,
): Promise<LocationInput[]> {
  if (kind === "sites") return locations.filter((l) => isLive(l, now));

  // The closing photo is asked after the run, so status doesn't matter;
  // installation and mid-date only make sense while the site is up.
  const candidates =
    kind === "end_date" ? locations : locations.filter((l) => isLive(l, now));
  if (candidates.length === 0) return [];

  // Drop any location that already has this stage's photo for the current term.
  const uploaded = await Attachment.find(
    { locationId: { $in: candidates.map((l) => l._id) }, stage: kind, term },
    { locationId: 1 },
  ).lean();
  const done = new Set(uploaded.map((a) => String(a.locationId)));
  return candidates.filter((l) => !done.has(String(l._id)));
}

/**
 * Send one `kind` of vendor email for whichever of `locations` qualify. One
 * email per vendor, from the campaign owner's own mailbox. Vendors in
 * `skipVendorIds` (already sent today) are left out.
 */
export async function sendVendorMailNow(input: {
  kind: VendorReminderKind;
  owner: { _id: Types.ObjectId; name: string; email: string; appPassword: string };
  campaignId: Types.ObjectId;
  term: number;
  clientName: string;
  locations: LocationInput[];
  skipVendorIds?: Set<string>;
  now?: Date;
}): Promise<{ sentTo: string[]; errors: string[]; due: number }> {
  const now = input.now ?? new Date();
  const day = businessToday(now);

  const qualifying = await qualifyingLocations(
    input.kind,
    input.locations,
    input.term,
    now,
  );

  const byVendor = new Map<string, LocationInput[]>();
  for (const l of qualifying) {
    if (!l.vendorId) continue;
    const key = String(l.vendorId);
    if (input.skipVendorIds?.has(key)) continue;
    const list = byVendor.get(key);
    if (list) list.push(l);
    else byVendor.set(key, [l]);
  }
  if (byVendor.size === 0) return { sentTo: [], errors: [], due: 0 };

  const vendors = await Vendor.find(
    { _id: { $in: [...byVendor.keys()] }, "emails.0": { $exists: true } },
    { name: 1, emails: 1 },
  ).lean<VendorRef[]>();
  if (vendors.length === 0) return { sentTo: [], errors: [], due: 0 };

  const sentTo: string[] = [];
  const errors: string[] = [];
  const transport = createTransport(input.owner.email, input.owner.appPassword);

  try {
    for (const vendor of vendors) {
      const locs = byVendor.get(String(vendor._id))!;
      const message =
        input.kind === "sites"
          ? buildVendorReminder({
              fromName: input.owner.name,
              vendorName: vendor.name,
              clientName: input.clientName,
              locations: locs.map((l) => toVendorLocation(l, now)),
            })
          : buildVendorMonitoringReminder({
              fromName: input.owner.name,
              vendorName: vendor.name,
              clientName: input.clientName,
              stage: input.kind,
              locations: locs.map(toMonitoringLocation),
            });

      try {
        await sendMailWith(transport, {
          fromName: input.owner.name,
          fromEmail: input.owner.email,
          to: vendor.emails.join(", "),
          message,
        });
      } catch (err) {
        console.error(`[vendor:${input.kind}] send to ${vendor.name} failed:`, err);
        errors.push(`${vendor.name}: email failed`);
        continue;
      }

      sentTo.push(...vendor.emails);
      await VendorReminder.updateOne(
        { vendorId: vendor._id, campaignId: input.campaignId, day, kind: input.kind },
        { $set: { userId: input.owner._id, sentAt: new Date(), sentTo: vendor.emails } },
        { upsert: true },
      );
    }
  } finally {
    transport.close();
  }

  return { sentTo, errors, due: vendors.length };
}

export type VendorScheduleResult = {
  date: string;
  /** Emails sent, per stage. */
  sent: Record<VendorStage, number>;
  errors: { campaignId: string; error: string }[];
};

/**
 * The hourly cron's half: every campaign with today on one of its stage date
 * lists gets that stage's ask sent to its vendors. Safe to repeat — a vendor
 * already logged for (campaign, today, stage) is skipped.
 */
export async function runScheduledVendorReminders(
  now: Date = new Date(),
): Promise<VendorScheduleResult> {
  await connectDB();
  const day = businessToday(now);
  const result: VendorScheduleResult = {
    date: day.toISOString(),
    sent: { installation: 0, mid_date: 0, end_date: 0 },
    errors: [],
  };

  for (const stage of VENDOR_STAGES) {
    const campaigns = await Campaign.find({ [`vendorReminderDates.${stage}`]: day }).lean();

    for (const c of campaigns) {
      try {
        const [owner, client, already] = await Promise.all([
          User.findById(c.userId, { name: 1, email: 1, appPassword: 1 }).lean(),
          Client.findById(c.clientId, { name: 1 }).lean(),
          VendorReminder.find(
            { campaignId: c._id, day, kind: stage },
            { vendorId: 1 },
          ).lean(),
        ]);
        if (!owner?.appPassword?.trim() || !client) continue;

        const r = await sendVendorMailNow({
          kind: stage,
          owner: {
            _id: owner._id,
            name: owner.name,
            email: owner.email,
            appPassword: decryptSecret(owner.appPassword),
          },
          campaignId: c._id,
          term: c.term ?? 1,
          clientName: client.name,
          skipVendorIds: new Set(already.map((a) => String(a.vendorId))),
          now,
          locations: (c.locations as unknown as (LocationInput & { type?: string })[]).map(
            (l) => ({ ...l, medium: l.medium ?? l.type ?? "", midDate: l.midDate ?? null }),
          ),
        });
        result.sent[stage] += r.sentTo.length;
        for (const e of r.errors) result.errors.push({ campaignId: String(c._id), error: e });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        console.error(`[vendor:${stage}] campaign ${String(c._id)} failed:`, error);
        result.errors.push({ campaignId: String(c._id), error });
      }
    }
  }

  return result;
}
