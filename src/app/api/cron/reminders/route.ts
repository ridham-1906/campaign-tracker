import { NextRequest, NextResponse } from "next/server";
import { runDueReminders } from "@/lib/reminders";

// Node runtime required (mongoose + nodemailer are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SMTP sends are slow and the default serverless timeout (10s) kills the run
// mid-batch. 60s is the ceiling on Hobby and is allowed on every plan; raise it
// if you're on Pro and genuinely need longer. runDueReminders holds its own
// slightly shorter budget so it returns a report rather than being hard-killed,
// and anything it defers is picked up by the next run.
export const maxDuration = 60;

/**
 * Daily reminder job for every user, triggered by an external scheduler
 * (cron-job.org or similar) once a day:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/reminders
 * Schedulers that can't set headers may pass ?secret=$CRON_SECRET instead —
 * prefer the header, since query strings show up in logs.
 *
 * Safe to call more than once a day: sent reminders are marked, so a repeat run
 * only picks up what's still outstanding.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? req.nextUrl.searchParams.get("secret");

  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDueReminders();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
