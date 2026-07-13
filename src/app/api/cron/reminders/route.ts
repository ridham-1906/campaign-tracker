import { NextRequest, NextResponse } from "next/server";
import { runDueReminders } from "@/lib/reminders";

// Node runtime required (mongoose + nodemailer are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily reminder job. Trigger once per day via any scheduler:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://host/api/cron/reminders
 * or Vercel Cron (see vercel.json), which sends the secret automatically.
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
