import "server-only";
import type { Transporter } from "nodemailer";
import { connectDB } from "@/lib/db";
import { Reminder } from "@/models";
import { createTransport, sendReminderWith } from "@/lib/mailer";
import { daysUntil, startOfDay } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";

export type ReminderRunResult = {
  date: string;
  due: number;
  sent: number;
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

type PopulatedCampaign = {
  _id: unknown;
  city: string;
  type: string;
  location: string;
  status: string;
  endDate: Date;
  salesId?: { name: string; email: string };
  vendorId?: { name: string };
  clientId?: { name: string };
  userId?: { _id: unknown; name: string; email: string; appPassword: string };
};

/**
 * Find every unsent reminder scheduled for `now`'s day or earlier (catching up
 * on any backlog from days the job didn't run) and email the campaign's sales
 * person, using the days-remaining as of today. Called by the daily cron route.
 *
 * Covers every user in one run: reminders are grouped by their campaign's owner
 * and sent from that owner's own mailbox, over a single pooled connection per
 * owner. Idempotent — reminders are marked sent, so re-running won't
 * double-send, and anything not reached (error or time budget) is retried on
 * the next run.
 */
export async function runDueReminders(
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  await connectDB();

  const startedAt = Date.now();
  const deadline = startedAt + timeBudgetMs;

  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const due = await Reminder.find({
    sent: false,
    date: { $lt: dayEnd },
  })
    .populate({
      path: "campaignId",
      populate: [
        { path: "salesId", select: "name email" },
        { path: "vendorId", select: "name" },
        { path: "clientId", select: "name" },
        { path: "userId", select: "name email appPassword" },
      ],
    })
    .exec();

  const result: ReminderRunResult = {
    date: dayStart.toISOString(),
    due: due.length,
    sent: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
  };

  // Group the sendable reminders by owning user, dropping any whose campaign
  // or relations were deleted, or whose campaign already ended.
  type Job = { reminder: (typeof due)[number]; campaign: PopulatedCampaign };
  const byUser = new Map<string, Job[]>();

  for (const reminder of due) {
    const campaign = reminder.campaignId as unknown as PopulatedCampaign | null;

    if (
      !campaign ||
      !campaign.salesId ||
      !campaign.userId ||
      campaign.status === "ENDED"
    ) {
      result.skipped++;
      continue;
    }

    const userId = String(campaign.userId._id);
    const jobs = byUser.get(userId);
    if (jobs) jobs.push({ reminder, campaign });
    else byUser.set(userId, [{ reminder, campaign }]);
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
      for (const { reminder, campaign } of jobs) {
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
            clientName: campaign.clientId?.name ?? "—",
            vendorName: campaign.vendorId?.name ?? "—",
            city: campaign.city,
            type: campaign.type,
            location: campaign.location,
            endDate: new Date(campaign.endDate),
            daysLeft: Math.max(0, daysUntil(new Date(campaign.endDate), now)),
            appUrl: process.env.APP_URL ?? "http://localhost:3000",
          });

          reminder.sent = true;
          reminder.sentAt = new Date();
          await reminder.save();
          result.sent++;
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
