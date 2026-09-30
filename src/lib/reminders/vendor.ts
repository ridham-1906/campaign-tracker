import "server-only";
import type { Transporter } from "nodemailer";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, Client, User, Vendor, VendorReminder } from "@/models";
import { createTransport, sendMailWith } from "@/lib/mailer";
import {
  buildErrorUpdate,
  ERROR_REPORT_TO,
  type ReminderFailure,
} from "@/lib/mail/error-update";
import { buildVendorReminder, type VendorLocation } from "@/lib/mail/vendor-reminder";
import {
  buildVendorMidReminder,
  type MidMonitoringLocation,
} from "@/lib/mail/vendor-mid-reminder";
import { businessToday, daysUntil, lifecycleState } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";
import { DEFAULT_TIME_BUDGET_MS, runPool } from "./runner";
import type { Person, ReminderRunResult } from "./types";

/**
 * Vendor reminders. Each vendor carries its own list of calendar dates; on each
 * of them, every vendor with an email is sent one message per campaign it has
 * LIVE sites on, listing just those sites — never another vendor's, and never
 * an ended or pending-creative one. Sales people are untouched by this file.
 *
 * This doesn't fit `ReminderKind`: the schedule lives on the shared Vendor
 * record rather than on the locations, and the recipient differs per location
 * group rather than per campaign. So it has its own planner, but reuses the
 * runner's mailbox pool and time budget.
 *
 * A date that passes without a successful send is skipped, not caught up:
 * the hourly job retries through the day, and after that it's too late to be
 * useful. Dedupe is the unique (vendor, campaign, day) row in VendorReminder.
 */

type VendorRef = { _id: Types.ObjectId; name: string; emails: string[] };

type LocationRow = {
  vendorId: Types.ObjectId;
  city: string;
  location: string;
  medium?: string | null;
  status: string;
  startDate: Date;
  endDate: Date;
};

export type VendorJob = {
  campaignId: Types.ObjectId;
  vendor: VendorRef;
  locations: LocationRow[];
  client?: { name: string };
  owner?: { _id: Types.ObjectId } & Person & { appPassword?: string };
};

function toVendorLocation(l: LocationRow, now: Date): VendorLocation {
  return {
    location: l.location,
    city: l.city,
    medium: l.medium ?? "",
    startDate: new Date(l.startDate),
    endDate: new Date(l.endDate),
    daysLeft: Math.max(0, daysUntil(new Date(l.endDate), now)),
  };
}

/** Vendors only hear about LIVE sites: not ended, not waiting on creative. */
const isLive = (l: LocationRow, now: Date) =>
  lifecycleState({ status: l.status, endDate: new Date(l.endDate) }, now) === "LIVE";

const isDuplicateKey = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

/** Every (vendor, campaign) pair due an email today and not yet sent. */
export async function findVendorJobs(now: Date = new Date()): Promise<VendorJob[]> {
  await connectDB();
  const day = businessToday(now);

  const vendors = await Vendor.find(
    { reminderDates: day, "emails.0": { $exists: true } },
    { name: 1, emails: 1 },
  ).lean<VendorRef[]>();
  if (vendors.length === 0) return [];

  const ids = vendors.map((v) => v._id);
  const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

  const [campaigns, alreadySent] = await Promise.all([
    Campaign.aggregate<{
      _id: Types.ObjectId;
      locations: LocationRow[];
      client?: { name: string };
      owner?: VendorJob["owner"];
    }>([
      { $match: { "locations.vendorId": { $in: ids } } },
      {
        $project: {
          userId: 1,
          clientId: 1,
          // LIVE only, as in lifecycleState(): status LIVE and end not passed.
          // Ended and pending-creative sites are never sent to vendors.
          locations: {
            $map: {
              input: {
                $filter: {
                  input: "$locations",
                  as: "l",
                  cond: {
                    $and: [
                      { $in: ["$$l.vendorId", ids] },
                      { $eq: ["$$l.status", "LIVE"] },
                      { $gte: ["$$l.endDate", day] },
                    ],
                  },
                },
              },
              as: "l",
              in: {
                vendorId: "$$l.vendorId",
                city: "$$l.city",
                location: "$$l.location",
                medium: "$$l.medium",
                status: "$$l.status",
                startDate: "$$l.startDate",
                endDate: "$$l.endDate",
              },
            },
          },
        },
      },
      { $match: { $expr: { $gt: [{ $size: "$locations" }, 0] } } },
      {
        $lookup: {
          from: Client.collection.name,
          localField: "clientId",
          foreignField: "_id",
          as: "client",
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $lookup: {
          from: User.collection.name,
          localField: "userId",
          foreignField: "_id",
          as: "owner",
          pipeline: [{ $project: { name: 1, email: 1, appPassword: 1 } }],
        },
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
    ]).exec(),
    VendorReminder.find({ day, vendorId: { $in: ids } }, { vendorId: 1, campaignId: 1 }).lean(),
  ]);

  const sent = new Set(alreadySent.map((r) => `${r.vendorId}:${r.campaignId}`));
  const jobs: VendorJob[] = [];

  for (const c of campaigns) {
    const byVendor = new Map<string, LocationRow[]>();
    for (const l of c.locations) {
      const key = String(l.vendorId);
      const list = byVendor.get(key);
      if (list) list.push(l);
      else byVendor.set(key, [l]);
    }
    for (const [vendorId, locations] of byVendor) {
      if (sent.has(`${vendorId}:${c._id}`)) continue;
      jobs.push({
        campaignId: c._id,
        vendor: vendorById.get(vendorId)!,
        locations,
        client: c.client,
        owner: c.owner,
      });
    }
  }

  return jobs;
}

/**
 * Send today's vendor reminders across every user, from each campaign owner's
 * own mailbox. Safe to run repeatedly — see the claim-before-send note below.
 */
export async function runVendorReminders(
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  const deadline = Date.now() + timeBudgetMs;
  const day = businessToday(now);
  const jobs = await findVendorJobs(now);

  const result: ReminderRunResult = {
    kind: "vendor",
    date: day.toISOString(),
    due: 0,
    sent: 0,
    locationsSent: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
  };

  const byUser = new Map<string, VendorJob[]>();
  for (const job of jobs) {
    if (!job.owner || !job.client || !job.owner.appPassword?.trim()) {
      result.skipped++;
      continue;
    }
    result.due++;
    const userId = String(job.owner._id);
    const existing = byUser.get(userId);
    if (existing) existing.push(job);
    else byUser.set(userId, [job]);
  }

  async function runUser(userJobs: VendorJob[]) {
    const owner = userJobs[0].owner!;
    const failures: ReminderFailure[] = [];
    let transport: Transporter;

    try {
      transport = createTransport(owner.email, decryptSecret(owner.appPassword!));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[vendor] ${owner.email} transport failed for ${userJobs.length} email(s):`,
        error,
      );
      for (const job of userJobs) {
        result.errors.push({ campaignId: String(job.campaignId), error });
      }
      return;
    }

    try {
      for (const job of userJobs) {
        if (Date.now() >= deadline) {
          result.deferred++;
          continue;
        }

        // Claim before sending: the unique index means an overlapping run (or
        // a manual send) that got here first makes this insert fail, and we
        // skip rather than mail the vendor twice. The price is that a crash
        // between claim and send loses that one email instead of repeating it.
        try {
          await VendorReminder.create({
            vendorId: job.vendor._id,
            campaignId: job.campaignId,
            day,
            userId: owner._id,
          });
        } catch (err) {
          if (isDuplicateKey(err)) continue;
          throw err;
        }

        try {
          await sendMailWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: job.vendor.emails.join(", "),
            message: buildVendorReminder({
              fromName: owner.name,
              vendorName: job.vendor.name,
              clientName: job.client!.name,
              locations: job.locations.map((l) => toVendorLocation(l, now)),
            }),
          });
        } catch (err) {
          // Release the claim so the next hourly run retries today.
          await VendorReminder.deleteOne({
            vendorId: job.vendor._id,
            campaignId: job.campaignId,
            day,
          });
          const error = `${job.vendor.name}: ${err instanceof Error ? err.message : "Unknown error"}`;
          result.errors.push({ campaignId: String(job.campaignId), error });
          failures.push({
            at: new Date(),
            campaignId: String(job.campaignId),
            clientName: job.client!.name,
            error,
          });
          console.error(`[vendor] campaign ${String(job.campaignId)} failed:`, error);
          continue;
        }

        await VendorReminder.updateOne(
          { vendorId: job.vendor._id, campaignId: job.campaignId, day },
          { $set: { sentAt: new Date(), sentTo: job.vendor.emails } },
        );
        result.sent++;
        result.locationsSent += job.locations.length;
      }

      if (failures.length > 0 && ERROR_REPORT_TO) {
        try {
          await sendMailWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: ERROR_REPORT_TO,
            message: buildErrorUpdate({
              fromName: owner.name,
              ownerEmail: owner.email,
              failures,
            }),
          });
        } catch (err) {
          console.error("[vendor] error report failed to send:", err);
        }
      }
    } catch (err) {
      // A database failure shouldn't take the other users' groups down with it.
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(`[vendor] ${owner.email} group aborted:`, error);
      result.errors.push({ campaignId: "", error });
    } finally {
      transport.close();
    }
  }

  await runPool([...byUser.values()], runUser);
  return result;
}

/**
 * The manual "Send reminder" half for vendors: email each vendor with an
 * address about its own sites among `locations`, right now.
 *
 * Records today's send, so the automated job won't mail the same vendor about
 * this campaign again today. Failures are returned rather than thrown — the
 * sales email has already gone out by the time this runs.
 */
export async function sendVendorRemindersNow(input: {
  owner: { _id: Types.ObjectId; name: string; email: string; appPassword: string };
  campaignId: Types.ObjectId;
  clientName: string;
  locations: LocationRow[];
  now?: Date;
}): Promise<{ sentTo: string[]; errors: string[] }> {
  const now = input.now ?? new Date();
  const day = businessToday(now);

  const byVendor = new Map<string, LocationRow[]>();
  for (const l of input.locations) {
    if (!l.vendorId || !isLive(l, now)) continue;
    const key = String(l.vendorId);
    const list = byVendor.get(key);
    if (list) list.push(l);
    else byVendor.set(key, [l]);
  }
  if (byVendor.size === 0) return { sentTo: [], errors: [] };

  const vendors = await Vendor.find(
    { _id: { $in: [...byVendor.keys()] }, "emails.0": { $exists: true } },
    { name: 1, emails: 1 },
  ).lean<VendorRef[]>();
  if (vendors.length === 0) return { sentTo: [], errors: [] };

  const sentTo: string[] = [];
  const errors: string[] = [];
  const transport = createTransport(input.owner.email, input.owner.appPassword);

  try {
    for (const vendor of vendors) {
      try {
        await sendMailWith(transport, {
          fromName: input.owner.name,
          fromEmail: input.owner.email,
          to: vendor.emails.join(", "),
          message: buildVendorReminder({
            fromName: input.owner.name,
            vendorName: vendor.name,
            clientName: input.clientName,
            locations: byVendor
              .get(String(vendor._id))!
              .map((l) => toVendorLocation(l, now)),
          }),
        });
      } catch (err) {
        console.error(`[vendor] manual send to ${vendor.name} failed:`, err);
        errors.push(`${vendor.name}: email failed`);
        continue;
      }

      sentTo.push(...vendor.emails);
      await VendorReminder.updateOne(
        { vendorId: vendor._id, campaignId: input.campaignId, day },
        {
          $set: { userId: input.owner._id, sentAt: new Date(), sentTo: vendor.emails },
        },
        { upsert: true },
      );
    }
  } finally {
    transport.close();
  }

  return { sentTo, errors };
}

// ------------------------------------------------------- mid-monitoring

/**
 * Asks the vendor for the mid-campaign monitoring photo, once a site's mid
 * date arrives — independent of the vendor's own reminder dates above.
 *
 * Unlike the sales creative nag, "resolved" here isn't a status flip; it's
 * whether a "Mid date" photo has actually been uploaded against the location's
 * current term. Until then it repeats daily, deduped by `midReminderSentAt`
 * the same way the creative nag is. Ended or non-live sites are dropped, same
 * as the sites-are-due email above.
 */

type MidLocationRow = {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  city: string;
  location: string;
  medium?: string | null;
  startDate: Date;
  midDate: Date;
  endDate: Date;
};

export type VendorMidJob = {
  campaignId: Types.ObjectId;
  vendor: VendorRef;
  locations: MidLocationRow[];
  client?: { name: string };
  owner?: { _id: Types.ObjectId } & Person & { appPassword?: string };
};

/** Every (vendor, campaign) pair with a site past its mid date and no photo yet. */
export async function findMidMonitoringJobs(
  now: Date = new Date(),
): Promise<VendorMidJob[]> {
  await connectDB();
  const dayStart = businessToday(now);

  const candidates = await Campaign.aggregate<{
    _id: Types.ObjectId;
    term: number;
    locations: MidLocationRow[];
    client?: { name: string };
    owner?: VendorMidJob["owner"];
  }>([
    {
      $match: {
        locations: {
          $elemMatch: {
            midDate: { $ne: null, $lte: dayStart },
            status: "LIVE",
            endDate: { $gte: dayStart },
            $or: [
              { midReminderSentAt: null },
              { midReminderSentAt: { $lt: dayStart } },
            ],
          },
        },
      },
    },
    {
      $project: {
        userId: 1,
        clientId: 1,
        term: 1,
        locations: {
          $map: {
            input: {
              $filter: {
                input: "$locations",
                as: "l",
                cond: {
                  $and: [
                    { $ne: ["$$l.vendorId", null] },
                    { $ne: ["$$l.midDate", null] },
                    { $lte: ["$$l.midDate", dayStart] },
                    { $eq: ["$$l.status", "LIVE"] },
                    { $gte: ["$$l.endDate", dayStart] },
                    {
                      $or: [
                        { $eq: ["$$l.midReminderSentAt", null] },
                        { $lt: ["$$l.midReminderSentAt", dayStart] },
                      ],
                    },
                  ],
                },
              },
            },
            as: "l",
            in: {
              _id: "$$l._id",
              vendorId: "$$l.vendorId",
              city: "$$l.city",
              location: "$$l.location",
              medium: "$$l.medium",
              startDate: "$$l.startDate",
              midDate: "$$l.midDate",
              endDate: "$$l.endDate",
            },
          },
        },
      },
    },
    { $match: { $expr: { $gt: [{ $size: "$locations" }, 0] } } },
    {
      $lookup: {
        from: Client.collection.name,
        localField: "clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: "userId",
        foreignField: "_id",
        as: "owner",
        pipeline: [{ $project: { name: 1, email: 1, appPassword: 1 } }],
      },
    },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
  ]).exec();

  if (candidates.length === 0) return [];

  // Drop any location that already has its mid-point photo for the campaign's
  // *current* term — a location id is unique across the whole collection, so
  // matching on it alone (then checking term) is enough; no need to key by
  // campaign as well.
  const termByLocation = new Map<string, number>();
  const allLocationIds: Types.ObjectId[] = [];
  for (const c of candidates) {
    for (const l of c.locations) {
      termByLocation.set(String(l._id), c.term);
      allLocationIds.push(l._id);
    }
  }

  const uploaded = await Attachment.find(
    { locationId: { $in: allLocationIds }, stage: "mid_date" },
    { locationId: 1, term: 1 },
  ).lean();
  const fulfilled = new Set(
    uploaded
      .filter((a) => termByLocation.get(String(a.locationId)) === a.term)
      .map((a) => String(a.locationId)),
  );

  const vendorIds = [
    ...new Set(
      candidates.flatMap((c) => c.locations.map((l) => String(l.vendorId))),
    ),
  ];
  const vendors = await Vendor.find(
    { _id: { $in: vendorIds }, "emails.0": { $exists: true } },
    { name: 1, emails: 1 },
  ).lean<VendorRef[]>();
  const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

  const jobs: VendorMidJob[] = [];
  for (const c of candidates) {
    const byVendor = new Map<string, MidLocationRow[]>();
    for (const l of c.locations) {
      if (fulfilled.has(String(l._id))) continue;
      const vendor = vendorById.get(String(l.vendorId));
      if (!vendor) continue; // no email on file — nothing to send
      const list = byVendor.get(String(l.vendorId));
      if (list) list.push(l);
      else byVendor.set(String(l.vendorId), [l]);
    }
    for (const [vendorId, locations] of byVendor) {
      jobs.push({
        campaignId: c._id,
        vendor: vendorById.get(vendorId)!,
        locations,
        client: c.client,
        owner: c.owner,
      });
    }
  }

  return jobs;
}

function toMidMonitoringLocation(l: MidLocationRow): MidMonitoringLocation {
  return {
    location: l.location,
    city: l.city,
    medium: l.medium ?? "",
    startDate: new Date(l.startDate),
    midDate: new Date(l.midDate),
    endDate: new Date(l.endDate),
  };
}

/**
 * Send today's mid-monitoring nags across every user, from each campaign
 * owner's own mailbox. Marks every location a sent email covered, per campaign,
 * so a crash mid-run only risks re-sending what it already covered — never
 * silently drops a nag.
 */
export async function runVendorMidReminders(
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  const deadline = Date.now() + timeBudgetMs;
  const day = businessToday(now);
  const jobs = await findMidMonitoringJobs(now);

  const result: ReminderRunResult = {
    kind: "vendorMid",
    date: day.toISOString(),
    due: 0,
    sent: 0,
    locationsSent: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
  };

  const byUser = new Map<string, VendorMidJob[]>();
  for (const job of jobs) {
    if (!job.owner || !job.client || !job.owner.appPassword?.trim()) {
      result.skipped++;
      continue;
    }
    result.due++;
    const userId = String(job.owner._id);
    const existing = byUser.get(userId);
    if (existing) existing.push(job);
    else byUser.set(userId, [job]);
  }

  async function runUser(userJobs: VendorMidJob[]) {
    const owner = userJobs[0].owner!;
    const failures: ReminderFailure[] = [];
    let transport: Transporter;

    try {
      transport = createTransport(owner.email, decryptSecret(owner.appPassword!));
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[vendorMid] ${owner.email} transport failed for ${userJobs.length} email(s):`,
        error,
      );
      for (const job of userJobs) {
        result.errors.push({ campaignId: String(job.campaignId), error });
      }
      return;
    }

    try {
      for (const job of userJobs) {
        if (Date.now() >= deadline) {
          result.deferred++;
          continue;
        }

        try {
          await sendMailWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: job.vendor.emails.join(", "),
            message: buildVendorMidReminder({
              fromName: owner.name,
              vendorName: job.vendor.name,
              clientName: job.client!.name,
              locations: job.locations.map(toMidMonitoringLocation),
            }),
          });
        } catch (err) {
          const error = `${job.vendor.name}: ${err instanceof Error ? err.message : "Unknown error"}`;
          result.errors.push({ campaignId: String(job.campaignId), error });
          failures.push({
            at: new Date(),
            campaignId: String(job.campaignId),
            clientName: job.client!.name,
            error,
          });
          console.error(`[vendorMid] campaign ${String(job.campaignId)} failed:`, error);
          continue;
        }

        // Flush per job, not per group — a run killed mid-flight must never
        // leave a delivered email unrecorded, or it re-sends tomorrow's run.
        await Campaign.updateOne(
          { _id: job.campaignId },
          { $set: { "locations.$[loc].midReminderSentAt": new Date() } },
          { arrayFilters: [{ "loc._id": { $in: job.locations.map((l) => l._id) } }] },
        );

        result.sent++;
        result.locationsSent += job.locations.length;
      }

      if (failures.length > 0 && ERROR_REPORT_TO) {
        try {
          await sendMailWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: ERROR_REPORT_TO,
            message: buildErrorUpdate({
              fromName: owner.name,
              ownerEmail: owner.email,
              failures,
            }),
          });
        } catch (err) {
          console.error("[vendorMid] error report failed to send:", err);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(`[vendorMid] ${owner.email} group aborted:`, error);
      result.errors.push({ campaignId: "", error });
    } finally {
      transport.close();
    }
  }

  await runPool([...byUser.values()], runUser);
  return result;
}
