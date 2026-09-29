import { getCampaignLocationsIndex } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every (campaign, location) pair the user owns, flattened — used by the
 * folder-upload wizard to match a dropped folder's name against location,
 * city and client names client-side. See lib/folder-match.ts.
 */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(await getCampaignLocationsIndex(auth.session.userId));
}
