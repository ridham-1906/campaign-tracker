import "server-only";
import type { Transporter } from "nodemailer";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Sales, User } from "@/models";
import { createTransport, sendMailWith } from "@/lib/mailer";
import {
  buildErrorUpdate,
  ERROR_REPORT_TO,
  type ReminderFailure,
} from "@/lib/mail/error-update";
import { addDays, businessToday, EXPIRY_REMINDER_OFFSETS } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";
import type { Job, ReminderKind, ReminderRunResult, Window } from "./types";

/**
 * Scheduling, sending and bookkeeping shared by every reminder kind. What to
 * send, and to which locations, comes from the `ReminderKind` passed in.
 */

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

function windowFor(now: Date): Window {
  const dayStart = businessToday(now);
  return {
    dayStart,
    dayEnd: addDays(dayStart, 1),
    windowEnd: addDays(dayStart, EXPIRY_REMINDER_OFFSETS[0]),
  };
}

/**
 * Everything due for one kind, filtered and projected by Mongo rather than in
 * JS: only the locations that need an email come back, and only their mailable
 * fields. Relations are joined here too, so one round trip builds every job.
 */
export async function findDueJobs(
  kind: ReminderKind,
  now: Date = new Date(),
): Promise<Job[]> {
  await connectDB();
  const w = windowFor(now);

  const mailable = (l: string) => ({
    _id: `${l}._id`,
    city: `${l}.city`,
    location: `${l}.location`,
    type: `${l}.type`,
    startDate: `${l}.startDate`,
    endDate: `${l}.endDate`,
  });

  const join = (from: string, localField: string, as: string, fields: object) => ({
    $lookup: {
      from,
      localField,
      foreignField: "_id",
      as,
      pipeline: [{ $project: fields }],
    },
  });

  return Campaign.aggregate<Job>([
    { $match: kind.match(w) },
    {
      $project: {
        userId: 1,
        clientId: 1,
        salesId: 1,
        locations: {
          $filter: { input: "$locations", as: "l", cond: kind.cond(w) },
        },
      },
    },
    { $match: { $expr: { $gt: [{ $size: "$locations" }, 0] } } },
    {
      $project: {
        userId: 1,
        clientId: 1,
        salesId: 1,
        // Drops attachments and every other field the emails don't need.
        locations: {
          $map: { input: "$locations", as: "l", in: mailable("$$l") },
        },
      },
    },
    join(Sales.collection.name, "salesId", "sales", { name: 1, email: 1 }),
    join(Client.collection.name, "clientId", "client", { name: 1 }),
    join(User.collection.name, "userId", "owner", {
      name: 1,
      email: 1,
      appPassword: 1,
    }),
    // Relations may have been deleted; keep the campaign so it counts as skipped.
    { $unwind: { path: "$sales", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
  ]).exec();
}

/**
 * Email each campaign's sales person about the locations `kind` says are due —
 * one message per campaign rather than one per site.
 *
 * Covers every user in one run: campaigns are grouped by owner and sent from
 * that owner's own mailbox over a single pooled connection, a bounded number of
 * owners at a time. Idempotent — sends are recorded per location, so re-running
 * won't double-send, and anything not reached (error or time budget) is picked
 * up by the next run.
 */
export async function runReminders(
  kind: ReminderKind,
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  const deadline = Date.now() + timeBudgetMs;
  const jobs = await findDueJobs(kind, now);

  const result: ReminderRunResult = {
    kind: kind.name,
    date: businessToday(now).toISOString(),
    due: 0,
    sent: 0,
    locationsSent: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
  };

  const byUser = new Map<string, Job[]>();

  for (const job of jobs) {
    if (!job.sales || !job.owner || !job.client) {
      result.skipped++;
      continue;
    }

    result.due++;
    const userId = String(job.owner._id);
    const existing = byUser.get(userId);
    if (existing) existing.push(job);
    else byUser.set(userId, [job]);
  }

  async function runUser(userJobs: Job[]) {
    // Every job in the group shares an owner, so one transport serves them all.
    const owner = userJobs[0].owner!;
    const failures: ReminderFailure[] = [];
    let transport: Transporter;

    try {
      transport = createTransport(owner.email, decryptSecret(owner.appPassword));
    } catch (err) {
      // A bad/undecryptable app password fails the whole group, not the run.
      // There is no mailbox to report from either, so this only reaches the log.
      const error = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[${kind.name}] ${owner.email} transport failed for ${userJobs.length} campaign(s):`,
        error,
      );
      for (const job of userJobs) {
        result.errors.push({ campaignId: String(job._id), error });
      }
      return;
    }

    try {
      for (const job of userJobs) {
        if (Date.now() >= deadline) {
          result.deferred++;
          continue;
        }

        let delivered = false;
        try {
          await sendMailWith(transport, {
            fromName: owner.name,
            fromEmail: owner.email,
            to: job.sales!.email,
            message: kind.message({
              fromName: owner.name,
              salesName: job.sales!.name,
              clientName: job.client!.name,
              locations: job.locations,
              now,
            }),
          });
          delivered = true;
        } catch (err) {
          const error = err instanceof Error ? err.message : "Unknown error";
          result.errors.push({ campaignId: String(job._id), error });
          failures.push({
            at: new Date(),
            campaignId: String(job._id),
            clientName: job.client!.name,
            error,
          });
          console.error(`[${kind.name}] campaign ${String(job._id)} failed:`, error);
        }

        if (!delivered) continue;

        // Flush per campaign, not per group: a run killed mid-flight must never
        // leave a delivered email unrecorded, or it re-sends on the next run.
        const ops = kind.mark(job._id, job.locations, new Date(), now);
        if (ops.length > 0) await Campaign.bulkWrite(ops, { ordered: false });

        result.sent++;
        result.locationsSent += job.locations.length;
      }

      // Failures always reach the log; the digest only goes out if a recipient
      // is configured.
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
          console.error(`[${kind.name}] error report failed to send:`, err);
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
