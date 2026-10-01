import "server-only";
import { runReminders, findDueJobs, DEFAULT_TIME_BUDGET_MS } from "./runner";
import { expiryReminders } from "./expiry";
import { creativeReminders } from "./creative";

/**
 * Two scheduled reminder jobs, each with its own route:
 *
 *   expiry   — 7/5/3/2/1 days before a location ends, run hourly so a failed
 *              send retries within the hour
 *   creative — a daily nudge while a location sits on PENDING_CREATIVE
 *
 * Their differences live in `expiry.ts` and `creative.ts`; the scheduling,
 * pooled sending and bookkeeping they share live in `runner.ts`.
 *
 * Vendor photo requests ride along on the hourly expiry route: each campaign
 * holds its own installation / mid / end date lists, set from "Remind vendor…"
 * on the campaigns screen. See `vendor.ts`.
 */

export const runExpiryReminders = (now?: Date) => runReminders(expiryReminders, now);

export const runCreativeReminders = (now?: Date) =>
  runReminders(creativeReminders, now);

export { sendVendorMailNow, runScheduledVendorReminders } from "./vendor";

export { expiryReminders, creativeReminders, findDueJobs, DEFAULT_TIME_BUDGET_MS };
export type { ReminderRunResult, ReminderKind, Job } from "./types";
