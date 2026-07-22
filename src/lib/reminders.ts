import "server-only";
import type { Transporter } from "nodemailer";
import type { AnyBulkWriteOperation, Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Sales, User } from "@/models";
import { createTransport, sendMailWith } from "@/lib/mailer";
import { buildExpiryReminder } from "@/lib/mail/expiry-reminder";
import { buildCreativeReminder } from "@/lib/mail/creative-reminder";
import {
  buildErrorUpdate,
  ERROR_REPORT_TO,
  type ReminderFailure,
} from "@/lib/mail/error-update";
import {
  addDays,
  businessToday,
  daysUntil,
  EXPIRY_REMINDER_OFFSETS,
  reminderScheduleFor,
} from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";

export type ReminderRunResult = {
  date: string;
  /** Campaigns with at least one due location (i.e. emails to send). */
  due: number;
  /** Expiry emails actually sent. */
  sent: number;
  /** Locations covered by those emails. */
  locationsSent: number;
  /** Pending-creative emails actually sent. */
  creativeSent: number;
  creativeLocationsSent: number;
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

/** Only the location fields the emails actually need — attachments stay in Mongo. */
type DueLocation = {
  _id: Types.ObjectId;
  city: string;
  location: string;
  type: string;
  startDate: Date;
  endDate: Date;
};

type Person = { name: string; email: string };

type Job = {
  _id: Types.ObjectId;
  expiring: DueLocation[];
  creative: DueLocation[];
  sales?: Person;
  client?: { name: string };
  owner?: { _id: Types.ObjectId } & Person & { appPassword: string };
};

/**
 * Everything due today, filtered and projected by Mongo rather than in JS: only
 * the locations that actually need an email come back, and only their mailable
 * fields. Relations are joined here too, so one round trip builds every job.
 */
export async function findDueJobs(now: Date): Promise<Job[]> {
  await connectDB();

  const dayStart = businessToday(now);
  const dayEnd = addDays(dayStart, 1);
  const windowEnd = addDays(dayStart, EXPIRY_REMINDER_OFFSETS[0]);

  const notSentToday = (field: string) => ({
    $or: [{ $eq: [`$$l.${field}`, null] }, { $lt: [`$$l.${field}`, dayStart] }],
  });

  const mailable = (l: string) => ({
    _id: `${l}._id`,
    city: `${l}.city`,
    location: `${l}.location`,
    type: `${l}.type`,
    startDate: `${l}.startDate`,
    endDate: `${l}.endDate`,
  });

  const join = (from: string, localField: string, as: string, fields: object) => ({
    $lookup: { from, localField, foreignField: "_id", as, pipeline: [{ $project: fields }] },
  });

  return Campaign.aggregate<Job>([
    {
      $match: {
        $or: [
          {
            locations: {
              $elemMatch: {
                reminderDate: { $lt: dayEnd },
                endDate: { $gte: dayStart },
              },
            },
          },
          {
            locations: {
              $elemMatch: {
                status: "PENDING_CREATIVE",
                endDate: { $gte: dayStart },
              },
            },
          },
        ],
      },
    },
    {
      $project: {
        userId: 1,
        clientId: 1,
        salesId: 1,
        // `reminderSent` is deliberately not consulted: dedupe is by
        // `reminderSentAt`, which lets pre-series documents heal themselves.
        expiring: {
          $filter: {
            input: "$locations",
            as: "l",
            cond: {
              $and: [
                { $ne: ["$$l.status", "ENDED"] },
                { $gte: ["$$l.endDate", dayStart] },
                { $lte: ["$$l.endDate", windowEnd] },
                { $lt: ["$$l.reminderDate", dayEnd] },
                notSentToday("reminderSentAt"),
              ],
            },
          },
        },
        creative: {
          $filter: {
            input: "$locations",
            as: "l",
            cond: {
              $and: [
                { $eq: ["$$l.status", "PENDING_CREATIVE"] },
                { $gte: ["$$l.endDate", dayStart] },
                notSentToday("creativeReminderSentAt"),
              ],
            },
          },
        },
      },
    },
    {
      $match: {
        $expr: {
          $or: [
            { $gt: [{ $size: "$expiring" }, 0] },
            { $gt: [{ $size: "$creative" }, 0] },
          ],
        },
      },
    },
    {
      $project: {
        userId: 1,
        clientId: 1,
        salesId: 1,
        expiring: { $map: { input: "$expiring", as: "l", in: mailable("$$l") } },
        creative: { $map: { input: "$creative", as: "l", in: mailable("$$l") } },
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
 * Record what was just emailed, touching only the affected subdocument fields
 * rather than rewriting the whole campaign.
 */
function markOps(job: Job, sent: { expiring: boolean; creative: boolean }, now: Date) {
  const ops: AnyBulkWriteOperation[] = [];
  const sentAt = new Date();
  // Tomorrow, so the milestone that just fired can't come due again today.
  const from = addDays(now, 1);

  if (sent.expiring) {
    for (const l of job.expiring) {
      const next = reminderScheduleFor(new Date(l.endDate), from);
      ops.push({
        updateOne: {
          filter: { _id: job._id },
          update: {
            $set: {
              "locations.$[loc].reminderDate": next.reminderDate,
              "locations.$[loc].reminderSent": next.reminderSent,
              "locations.$[loc].reminderSentAt": sentAt,
            },
          },
          arrayFilters: [{ "loc._id": l._id }],
        },
      });
    }
  }

  if (sent.creative) {
    ops.push({
      updateOne: {
        filter: { _id: job._id },
        update: {
          $set: { "locations.$[loc].creativeReminderSentAt": sentAt },
        },
        arrayFilters: [{ "loc._id": { $in: job.creative.map((l) => l._id) } }],
      },
    });
  }

  return ops;
}

export async function runDueReminders(
  now: Date = new Date(),
  { timeBudgetMs = DEFAULT_TIME_BUDGET_MS }: { timeBudgetMs?: number } = {},
): Promise<ReminderRunResult> {
  await connectDB();

  const deadline = Date.now() + timeBudgetMs;
  const dayStart = businessToday(now);
  const jobs = await findDueJobs(now);

  const result: ReminderRunResult = {
    date: dayStart.toISOString(),
    due: 0,
    sent: 0,
    locationsSent: 0,
    creativeSent: 0,
    creativeLocationsSent: 0,
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
        `[reminders] ${owner.email} transport failed for ${userJobs.length} campaign(s):`,
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

        const sent = { expiring: false, creative: false };
        try {
          if (job.expiring.length > 0) {
            await sendMailWith(transport, {
              fromName: owner.name,
              fromEmail: owner.email,
              to: job.sales!.email,
              message: buildExpiryReminder({
                fromName: owner.name,
                salesName: job.sales!.name,
                clientName: job.client!.name,
                locations: job.expiring.map((l) => ({
                  location: l.location,
                  city: l.city,
                  type: l.type,
                  endDate: new Date(l.endDate),
                  daysLeft: Math.max(0, daysUntil(new Date(l.endDate), now)),
                })),
              }),
            });
            sent.expiring = true;
          }

          if (job.creative.length > 0) {
            await sendMailWith(transport, {
              fromName: owner.name,
              fromEmail: owner.email,
              to: job.sales!.email,
              message: buildCreativeReminder({
                fromName: owner.name,
                salesName: job.sales!.name,
                clientName: job.client!.name,
                locations: job.creative.map((l) => ({
                  location: l.location,
                  city: l.city,
                  type: l.type,
                  startDate: new Date(l.startDate),
                  endDate: new Date(l.endDate),
                })),
              }),
            });
            sent.creative = true;
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : "Unknown error";
          result.errors.push({ campaignId: String(job._id), error });
          failures.push({
            at: new Date(),
            campaignId: String(job._id),
            clientName: job.client!.name,
            error,
          });
          console.error(`[reminders] campaign ${String(job._id)} failed:`, error);
        }

        // Flush per campaign, not per group: a run killed mid-flight must never
        // leave a delivered email unrecorded, or it re-sends on the next run.
        const ops = markOps(job, sent, now);
        if (ops.length > 0) await Campaign.bulkWrite(ops, { ordered: false });

        if (sent.expiring) {
          result.sent++;
          result.locationsSent += job.expiring.length;
        }
        if (sent.creative) {
          result.creativeSent++;
          result.creativeLocationsSent += job.creative.length;
        }
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
          console.error("[reminders] error report failed to send:", err);
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
