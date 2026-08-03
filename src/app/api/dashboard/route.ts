import { NextRequest } from "next/server";
import { CAMPAIGN_SORT_KEYS, getCampaignsPage } from "@/lib/data";
import { CAMPAIGN_STATUS_FILTERS } from "@/lib/view-types";
import { authGuard, ok, parseListParams } from "@/lib/api";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The shared dashboard: every user's campaigns, readable by every logged-in
 * user.
 *
 * Deliberately **not** `readScope(auth.session)` — that is what makes this a
 * different endpoint from `/api/campaigns` rather than a flag on it. The
 * campaigns screen stays owner-scoped (an admin excepted); this one is the
 * team-wide view, which is the whole point of its Backend column: a list of
 * only your own campaigns would repeat your own name on every row.
 *
 * Read-only by construction. There is no POST/PATCH/DELETE here, and the write
 * routes under /api/campaigns are all still scoped to `auth.session.userId`, so
 * widening the read never widens what anyone can change.
 */
const statusSchema = z.enum(CAMPAIGN_STATUS_FILTERS).catch("all");

export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const sp = req.nextUrl.searchParams;
  const params = parseListParams(sp, {
    sortKeys: CAMPAIGN_SORT_KEYS,
    defaultSort: "endDate",
  });

  return ok(
    await getCampaignsPage(null, {
      ...params,
      status: statusSchema.parse(sp.get("status") ?? undefined),
    }),
  );
}
