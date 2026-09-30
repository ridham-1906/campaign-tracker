import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_TIME_BUDGET_MS,
  runExpiryReminders,
  runVendorReminders,
  runVendorMidReminders,
} from "@/lib/reminders";
import { cronGuard } from "@/lib/api";

// Node runtime required (mongoose + nodemailer are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

/**
 * Expiry reminders (7/5/3/2/1 days before a location ends), triggered by an
 * external scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/reminders
 *
 * Meant to run several times a day so a failed or deferred send retries within
 * the hour. Safe to repeat: sends are recorded per location, so a repeat run
 * only picks up what's still outstanding.
 *
 * Vendor reminders (on each vendor's chosen dates, plus the mid-monitoring nag
 * once a site's mid date arrives) run here too, after the expiry pass and
 * inside what's left of the same time budget, so they get the same hourly
 * retries without a second scheduler entry. Anything they can't reach is
 * deferred to the next run that day.
 *
 * Pending-creative chasing lives at /api/cron/creative-reminders, since it runs
 * once a day rather than hourly.
 */
async function handle(req: NextRequest) {
  const denied = cronGuard(req);
  if (denied) return denied;

  const started = Date.now();
  const result = await runExpiryReminders();
  const vendor = await runVendorReminders(undefined, {
    timeBudgetMs: Math.max(0, DEFAULT_TIME_BUDGET_MS - (Date.now() - started)),
  });
  const vendorMid = await runVendorMidReminders(undefined, {
    timeBudgetMs: Math.max(0, DEFAULT_TIME_BUDGET_MS - (Date.now() - started)),
  });
  return NextResponse.json({ ok: true, ...result, vendor, vendorMid });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
