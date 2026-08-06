import { z } from "zod";
import { getCampaign } from "@/lib/data";
import { isValidId, renewCampaignForUser, validateRefs } from "@/lib/services";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";
import { locationSchema } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Its own endpoint rather than a flag on PATCH: a renewal archives the current
 * term and restarts the reminder series, which is the opposite of what an edit
 * means, and PATCH's "anything omitted is deleted" rule would throw away the
 * locations (and photos) of a site that simply wasn't rebooked.
 */
const renewSchema = z.object({
  locations: z
    .array(locationSchema)
    .min(1, "A renewal needs at least one location"),
});

/** Roll the campaign into its next term, in place — see renewCampaignForUser. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = renewSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const current = await getCampaign(auth.session.userId, id);
  if (!current) return notFound("Campaign not found");

  const refErr = await validateRefs({
    salesId: current.sales.id,
    clientId: current.client.id,
    vendorIds: parsed.data.locations.map((l) => l.vendorId),
  });
  if (refErr) return badRequest(refErr);

  const renewed = await renewCampaignForUser(auth.session.userId, id, parsed.data);
  if (!renewed) return notFound("Campaign not found");

  return ok(await getCampaign(auth.session.userId, id));
}
