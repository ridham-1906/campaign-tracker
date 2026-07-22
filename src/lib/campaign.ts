// Shared helpers for campaign dates / lifecycle. Pure functions, safe anywhere.

export const CAMPAIGN_STATUSES = ["LIVE", "ENDED", "PENDING_CREATIVE"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Days before a location's end date that the sales person is emailed. */
export const EXPIRY_REMINDER_OFFSETS = [7, 5, 3, 2, 1] as const;
export const DEFAULT_REMINDER_LEAD_DAYS = EXPIRY_REMINDER_OFFSETS[0];

/** Business timezone offset (IST). Dates are stored as UTC midnight, so this
 * is only used to work out which calendar day it currently is. */
const BUSINESS_UTC_OFFSET_MIN = 330;

/**
 * UTC midnight of the given date. Start/end/reminder dates are calendar dates,
 * not instants — pinning them to UTC keeps them identical whether the code runs
 * on a UTC server or an IST laptop.
 */
export function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Today's calendar date in the business timezone, as UTC midnight. */
export function businessToday(now: Date = new Date()) {
  return startOfDay(new Date(now.getTime() + BUSINESS_UTC_OFFSET_MIN * 60_000));
}

/** Whole days from today until `end` (negative if already past). */
export function daysUntil(end: Date, now: Date = new Date()) {
  const ms = startOfDay(end).getTime() - businessToday(now).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/**
 * The next reminder date on or after `from`, or null once the series is done.
 * Reminders escalate as the end date approaches rather than firing once.
 */
export function nextReminderDate(
  endDate: Date,
  from: Date = new Date(),
): Date | null {
  const day = businessToday(from);
  for (const offset of EXPIRY_REMINDER_OFFSETS) {
    const d = startOfDay(addDays(endDate, -offset));
    if (d >= day) return d;
  }
  return null;
}

/**
 * The reminder fields to store for a location. With no milestones left the date
 * is parked a day past the end so it can never come due again.
 */
export function reminderScheduleFor(endDate: Date, from: Date = new Date()) {
  const next = nextReminderDate(endDate, from);
  return {
    reminderDate: next ?? addDays(startOfDay(endDate), 1),
    reminderSent: next === null,
  };
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

export type LifecycleState = "LIVE" | "ENDED" | "PENDING_CREATIVE";

/**
 * A location is ENDED when marked so manually, or once its end date has
 * passed. PENDING_CREATIVE is a manual-only state (the creative isn't ready
 * yet) and doesn't flip to LIVE on its own; otherwise it's LIVE.
 */
export function lifecycleState(
  campaign: { status: string; endDate: Date },
  now: Date = new Date(),
): LifecycleState {
  if (campaign.status === "ENDED") return "ENDED";
  if (campaign.status === "PENDING_CREATIVE") return "PENDING_CREATIVE";
  if (daysUntil(campaign.endDate, now) < 0) return "ENDED";
  return "LIVE";
}

export function lifecycleLabel(state: LifecycleState) {
  if (state === "ENDED") return "Ended";
  if (state === "PENDING_CREATIVE") return "Pending creative";
  return "Live";
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
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
