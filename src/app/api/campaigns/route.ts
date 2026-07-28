import { z } from "zod";
import { NextRequest } from "next/server";
import { CAMPAIGN_SORT_KEYS, getCampaign, getCampaignsPage } from "@/lib/data";
import { createCampaignForUser, validateRefsOwned } from "@/lib/services";
import { CAMPAIGN_STATUS_FILTERS } from "@/lib/view-types";
import { authGuard, badRequest, created, ok, parseListParams, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One placement. The date rule applies per location, not campaign-wide. */
export const locationSchema = z
  .object({
    id: z.string().min(1).optional(),
    city: z.string().min(1),
    location: z.string().min(1),
    type: z.string().min(1),
    vendorId: z.string().min(1),
    startDate: z.coerce.date(),
    // Optional — the client always sends the key, an empty string meaning
    // "not set" rather than an invalid date.
    midDate: z.preprocess(
      (v) => (v === "" || v == null ? undefined : v),
      z.coerce.date().optional(),
    ),
    endDate: z.coerce.date(),
    status: z.enum(["LIVE", "ENDED", "PENDING_CREATIVE"]).optional(),
  })
  .refine((l) => l.endDate >= l.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  })
  .refine((l) => !l.midDate || (l.midDate >= l.startDate && l.midDate <= l.endDate), {
    message: "midDate must be between startDate and endDate",
    path: ["midDate"],
  });

const createSchema = z.object({
  clientId: z.string().min(1),
  salesId: z.string().min(1),
  locations: z.array(locationSchema).min(1, "Add at least one location"),
});

/** Same fallback-don't-400 policy as parseListParams: a junk status is "all". */
const statusSchema = z.enum(CAMPAIGN_STATUS_FILTERS).catch("all");

/**
 * Paginated. Rows omit `locations[].attachments` — the campaigns table has no
 * attachment column, and carrying them was roughly half the payload. Use
 * `GET /api/campaigns/:id` for the full campaign.
 *
 * Returns the `{rows,total,page,limit}` envelope; this used to be a bare
 * array of every campaign. See doc/rest-api.md.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const sp = req.nextUrl.searchParams;
  const params = parseListParams(sp, {
    sortKeys: CAMPAIGN_SORT_KEYS,
    defaultSort: "endDate",
  });

  return ok(
    await getCampaignsPage(auth.session.userId, {
      ...params,
      status: statusSchema.parse(sp.get("status") ?? undefined),
    }),
  );
}

export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const refErr = await validateRefsOwned(auth.session.userId, {
    salesId: parsed.data.salesId,
    clientId: parsed.data.clientId,
    vendorIds: parsed.data.locations.map((l) => l.vendorId),
  });
  if (refErr) return badRequest(refErr);

  const campaign = await createCampaignForUser(auth.session.userId, parsed.data);
  const view = await getCampaign(auth.session.userId, campaign._id.toString());
  return created(view);
}
