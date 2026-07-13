/**
 * Manually trigger the daily reminder job against a running server.
 *
 *   npm run dev          # in one terminal
 *   npm run reminders    # in another
 *
 * Hits POST /api/cron/reminders with the CRON_SECRET so it exercises the exact
 * same code path the scheduler uses.
 */
import "dotenv/config";

const base = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is not set. Add it to .env");
  process.exit(1);
}

async function main() {
  const res = await fetch(`${base}/api/cron/reminders`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(
    `Failed to reach ${base}. Is the dev server running?\n`,
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
