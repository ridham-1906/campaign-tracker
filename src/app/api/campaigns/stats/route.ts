import { NextRequest } from "next/server";
import { getCampaignStats } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Counts for the six stat tiles above the campaigns table. Its own endpoint
 * because they're totals over the whole result set and can't be derived from
 * a page.
 *
 * Takes the same `q` as the list, so the tiles reflect an active search — but
 * deliberately not `status`, since the tiles *are* the status filter.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const q = req.nextUrl.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  return ok(await getCampaignStats(auth.session.userId, { q }));
}
