import { NextRequest, NextResponse } from "next/server";
import { runExpiryReminders } from "@/lib/reminders";
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
 * Pending-creative chasing lives at /api/cron/creative-reminders, since it runs
 * once a day rather than hourly.
 */
async function handle(req: NextRequest) {
  const denied = cronGuard(req);
  if (denied) return denied;

  const result = await runExpiryReminders();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
