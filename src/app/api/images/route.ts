import { NextRequest } from "next/server";
import { IMAGE_SORT_KEYS, getCampaignImagesPage } from "@/lib/data";
import { authGuard, ok, parseListParams, readScope } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Uploaded files summarised into one row per campaign — what the images screen
 * renders. The files themselves come from `GET /api/campaigns/:id`, and are
 * streamed from `/api/campaigns/:id/locations/:locationId/attachments/:id`.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const params = parseListParams(req.nextUrl.searchParams, {
    sortKeys: IMAGE_SORT_KEYS,
    defaultSort: "uploadedAt",
    defaultDir: "desc",
  });
  return ok(await getCampaignImagesPage(readScope(auth.session), params));
}
