import { NextRequest, NextResponse } from "next/server";
import { runScheduledVendorReminders } from "@/lib/reminders";
import { cronGuard } from "@/lib/api";

// Node runtime required (mongoose + nodemailer are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

/**
 * Vendor photo requests, triggered by an external scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/vendor-reminders
 *
 * Any campaign with today on one of its installation / mid / end date lists
 * (set from "Remind vendor…") gets that stage's ask sent to its vendors.
 * Separate from /api/cron/reminders (sales expiry) so each can run on its own
 * schedule. Safe to repeat: a vendor already sent today is skipped, so extra
 * runs only retry failures.
 */
async function handle(req: NextRequest) {
  const denied = cronGuard(req);
  if (denied) return denied;

  const result = await runScheduledVendorReminders();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
