// Shared helpers for campaign dates / lifecycle. Pure functions, safe anywhere.

export const CAMPAIGN_STATUSES = ["LIVE", "ENDED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const DEFAULT_REMINDER_LEAD_DAYS = 7;

/** Midnight (local) of the given date. */
export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole days from today until `end` (negative if already past). */
export function daysUntil(end: Date, now: Date = new Date()) {
  const ms = startOfDay(end).getTime() - startOfDay(now).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** Default reminder date: `lead` days before the end date. */
export function defaultReminderDate(
  endDate: Date,
  lead = DEFAULT_REMINDER_LEAD_DAYS,
) {
  return startOfDay(addDays(endDate, -lead));
}

/** Inclusive campaign duration in whole days (minimum 1). */
export function durationDays(start: Date, end: Date) {
  return Math.max(
    1,
    Math.round(
      (startOfDay(end).getTime() - startOfDay(start).getTime()) / 86400000,
    ) + 1,
  );
}

export type LifecycleState = "LIVE" | "ENDED";

/**
 * A campaign is either LIVE or ENDED. It's ENDED when marked so manually, or
 * once its end date has passed; otherwise it's LIVE.
 */
export function lifecycleState(
  campaign: { status: string; endDate: Date },
  now: Date = new Date(),
): LifecycleState {
  if (campaign.status === "ENDED") return "ENDED";
  if (daysUntil(campaign.endDate, now) < 0) return "ENDED";
  return "LIVE";
}

export function lifecycleLabel(state: LifecycleState) {
  return state === "ENDED" ? "Ended" : "Live";
}

/** True when a live campaign is within the reminder window of its end date. */
export function isExpiringSoon(
  campaign: { status: string; endDate: Date },
  now: Date = new Date(),
  soonDays = DEFAULT_REMINDER_LEAD_DAYS,
) {
  if (lifecycleState(campaign, now) !== "LIVE") return false;
  const left = daysUntil(campaign.endDate, now);
  return left >= 0 && left <= soonDays;
}

/** Format a Date as yyyy-mm-dd for <input type="date"> without TZ drift. */
export function toDateInputValue(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
