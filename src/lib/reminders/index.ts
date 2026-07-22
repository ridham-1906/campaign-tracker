import "server-only";
import { runReminders, findDueJobs } from "./runner";
import { expiryReminders } from "./expiry";
import { creativeReminders } from "./creative";

/**
 * Two reminder jobs on separate schedules, each with its own route:
 *
 *   expiry   — 7/5/3/2/1 days before a location ends, run hourly so a failed
 *              send retries within the hour
 *   creative — a daily nudge while a location sits on PENDING_CREATIVE
 *
 * Their differences live in `expiry.ts` and `creative.ts`; the scheduling,
 * pooled sending and bookkeeping they share live in `runner.ts`.
 */

export const runExpiryReminders = (now?: Date) => runReminders(expiryReminders, now);

export const runCreativeReminders = (now?: Date) =>
  runReminders(creativeReminders, now);

export { expiryReminders, creativeReminders, findDueJobs };
export type { ReminderRunResult, ReminderKind, Job } from "./types";
