import "server-only";
import { runReminders, findDueJobs, DEFAULT_TIME_BUDGET_MS } from "./runner";
import { expiryReminders } from "./expiry";
import { creativeReminders } from "./creative";

/**
 * Two reminder jobs on separate schedules, each with its own route:
 *
 *   expiry   — 7/5/3/2/1 days before a location ends, run hourly so a failed
 *              send retries within the hour
 *   creative — a daily nudge while a location sits on PENDING_CREATIVE
 *   vendor   — on each vendor's chosen dates, its live sites per campaign;
 *              rides along on the hourly expiry route (see vendor.ts)
 *   vendorMid — a daily nudge to the vendor once a site's mid date arrives,
 *              until its mid-point photo is uploaded; also rides along here
 *
 * Their differences live in `expiry.ts` and `creative.ts`; the scheduling,
 * pooled sending and bookkeeping they share live in `runner.ts`.
 */

export const runExpiryReminders = (now?: Date) => runReminders(expiryReminders, now);

export const runCreativeReminders = (now?: Date) =>
  runReminders(creativeReminders, now);

export {
  runVendorReminders,
  runVendorMidReminders,
  sendVendorRemindersNow,
} from "./vendor";

export { expiryReminders, creativeReminders, findDueJobs, DEFAULT_TIME_BUDGET_MS };
export type { ReminderRunResult, ReminderKind, Job } from "./types";
