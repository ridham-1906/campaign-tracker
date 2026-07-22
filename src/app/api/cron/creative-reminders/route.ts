import { NextRequest, NextResponse } from "next/server";
import { runCreativeReminders } from "@/lib/reminders";
import { cronGuard } from "@/lib/api";

// Node runtime required (mongoose + nodemailer are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

/**
 * Chases every location still sitting on PENDING_CREATIVE, once a day:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://host/api/cron/creative-reminders
 *
 * Separate from /api/cron/reminders because that one runs hourly for retries,
 * while this is a daily nudge. Calling it twice in a day is harmless — a
 * location is only emailed once per day — so a retry costs nothing.
 */
async function handle(req: NextRequest) {
  const denied = cronGuard(req);
  if (denied) return denied;

  const result = await runCreativeReminders();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
