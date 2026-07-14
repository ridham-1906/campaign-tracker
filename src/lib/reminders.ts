import "server-only";
import type { Transporter } from "nodemailer";
import { connectDB } from "@/lib/db";
import { Campaign } from "@/models";
import {
  createTransport,
  sendReminderWith,
  type ReminderLocation,
} from "@/lib/mailer";
import { daysUntil, lifecycleState, startOfDay } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";

export type ReminderRunResult = {
  date: string;
  /** Campaigns with at least one due location (i.e. emails to send). */
  due: number;
  /** Emails actually sent. */
  sent: number;
  /** Locations covered by those emails. */
  locationsSent: number;
  skipped: number;
  /** Left unsent because the run ran out of time; picked up on the next run. */
  deferred: number;
  errors: { campaignId: string; error: string }[];
};

const USER_CONCURRENCY = Math.max(
  1,
  Number(process.env.REMINDER_USER_CONCURRENCY ?? 4),
);

/**
 * Stop starting new sends past this point so the run returns a report instead
 * of being killed mid-flight. Kept under the *caller's* timeout too — external
 * cron services (cron-job.org et al.) cap requests around 30s and will report a
 * failure if we hold the connection longer. Anything deferred is simply retried
 * on the next run, since the query picks up any past-due unsent reminder.
 * Override with REMINDER_TIME_BUDGET_MS.
 */
const DEFAULT_TIME_BUDGET_MS = Number(
  process.env.REMINDER_TIME_BUDGET_MS ?? 25_000,
);

type PopulatedLocation = {
  _id: unknown;
  city: string;
  location: string;
  type: string;
  status: string;
  endDate: Date;
  reminderDate: Date;
  reminderSent: boolean;
  reminderSentAt?: Date | null;
};

type PopulatedCampaign = {
  _id: unknown;
  locations: PopulatedLocation[];
  salesId?: { name: string; email: string };
  clientId?: { name: string };
  userId?: { _id: unknown; name: string; email: string; appPassword: string };
  save: () => Promise<unknown>;
};

/**
 * Email each campaign's sales person about the locations that are due — one
 * message per campaign listing every due location, rather than one per site.
 *
 * "Due" means the location's reminder date is today or earlier (so a day the
 * job didn't run is caught up automatically), it hasn't been sent, and the
 * location hasn't already ended.
 *
 * Covers every user in one run: campaigns are grouped by owner and sent from
 * that owner's own mailbox over a single pooled connection. Idempotent — sent
 * locations are marked, so re-running won't double-send, and anything not
 * reached (error or time budget) is retried on the next run.
 */
export async function runDueReminders(
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  await connectDB();

  const deadline = Date.now() + timeBudgetMs;

  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Reminders live on the locations, so this hands back whole campaigns with
  // their due locations already together — exactly the shape the digest needs.
  const campaigns = (await Campaign.find({
    locations: {
      $elemMatch: { reminderSent: false, reminderDate: { $lt: dayEnd } },
    },
  })
    .populate("salesId", "name email")
    .populate("clientId", "name")
    .populate("userId", "name email appPassword")
    .exec()) as unknown as PopulatedCampaign[];

  const result: ReminderRunResult = {
    date: dayStart.toISOString(),
    due: 0,
    sent: 0,
    locationsSent: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
  };

  /** Locations that are unsent, past due, and not already finished. */
  function dueLocationsOf(campaign: PopulatedCampaign) {
    return campaign.locations.filter(
      (l) =>
        !l.reminderSent &&
        new Date(l.reminderDate) < dayEnd &&
        lifecycleState({ status: l.status, endDate: new Date(l.endDate) }, now) ===
          "LIVE",
    );
  }

  type Job = { campaign: PopulatedCampaign; locations: PopulatedLocation[] };
  const byUser = new Map<string, Job[]>();

  for (const campaign of campaigns) {
    const locations = dueLocationsOf(campaign);

    // Relations may have been deleted, or every due location already ended.
    if (
      !campaign.salesId ||
      !campaign.userId ||
      !campaign.clientId ||
      locations.length === 0
    ) {
      result.skipped++;
      continue;
    }

    result.due++;
    const userId = String(campaign.userId._id);
    const jobs = byUser.get(userId);
    if (jobs) jobs.push({ campaign, locations });
    else byUser.set(userId, [{ campaign, locations }]);
  }

  async function runUser(jobs: Job[]) {
    // Every job in the group shares an owner, so one transport serves them all.
    const owner = jobs[0].campaign.userId!;
    let transport: Transporter;
    try {
      transport = createTransport(owner.email, decryptSecret(owner.appPassword), {
        pool: true,
      });
    } catch (err) {
      // A bad/undecryptable app password fails the whole group, not the run.
      for (const { campaign } of jobs) {
        result.errors.push({
          campaignId: String(campaign._id),
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
      return;
    }

    try {
      for (const { campaign, locations } of jobs) {
        if (Date.now() >= deadline) {
          result.deferred++;
          continue;
        }

        try {
          await sendReminderWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: campaign.salesId!.email,
            salesName: campaign.salesId!.name,
            clientName: campaign.clientId!.name,
            locations: locations.map(toReminderLocation(now)),
          });

          // One email covered all of them, so mark them together and persist
          // the campaign once.
          const sentAt = new Date();
          for (const l of locations) {
            l.reminderSent = true;
            l.reminderSentAt = sentAt;
          }
          await campaign.save();

          result.sent++;
          result.locationsSent += locations.length;
        } catch (err) {
          result.errors.push({
            campaignId: String(campaign._id),
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    } finally {
      transport.close();
    }
  }

  // Work through the user groups with a bounded number in flight at once.
  const groups = [...byUser.values()];
  let next = 0;
  const workers = Array.from(
    { length: Math.min(USER_CONCURRENCY, groups.length) },
    async () => {
      while (next < groups.length) {
        const group = groups[next++];
        await runUser(group);
      }
    },
  );
  await Promise.all(workers);

  return result;
}

/** Days-left is computed fresh at send time, not when the reminder was set. */
export function toReminderLocation(now: Date) {
  return (l: PopulatedLocation): ReminderLocation => ({
    location: l.location,
    city: l.city,
    type: l.type,
    endDate: new Date(l.endDate),
    daysLeft: Math.max(0, daysUntil(new Date(l.endDate), now)),
  });
}
