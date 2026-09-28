import { NextRequest } from "next/server";
import { getCampaignStats } from "@/lib/data";
import { authGuard, ok, parseCampaignFilters } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live/Ended totals for the shared dashboard's tiles — across every user, the
 * same unscoped read as the list beside it (see ../route.ts). Its own endpoint
 * because they're totals over the whole result set, not derivable from a page.
 *
 * Takes the same `q` and filter bar as the list so the tiles reflect them, but
 * not `status`, since the tiles *are* the status filter.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim().slice(0, 100) || undefined;
  return ok(await getCampaignStats(null, { q, ...parseCampaignFilters(sp) }));
}
