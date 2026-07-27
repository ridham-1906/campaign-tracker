import { getCampaignOptions } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `{id, clientName, locationCount}` for the add-images wizard's campaign
 * picker. The wizard used to receive every campaign with its full locations
 * and attachments; it now picks from this and fetches the one campaign it
 * needs from `/api/campaigns/:id`.
 */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(await getCampaignOptions(auth.session.userId));
}
