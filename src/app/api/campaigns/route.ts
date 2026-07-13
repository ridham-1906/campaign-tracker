import { z } from "zod";
import { getCampaign, getCampaigns } from "@/lib/data";
import { createCampaignForUser, validateRefsOwned } from "@/lib/services";
import { authGuard, badRequest, created, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    clientId: z.string().min(1),
    salesId: z.string().min(1),
    vendorId: z.string().min(1),
    city: z.string().min(1),
    type: z.string().min(1),
    location: z.string().min(1),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    status: z.enum(["LIVE", "ENDED"]).optional(),
    reminderDate: z.coerce.date().optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const campaigns = await getCampaigns(auth.session.userId);
  return ok(campaigns);
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
    vendorId: parsed.data.vendorId,
    clientId: parsed.data.clientId,
  });
  if (refErr) return badRequest(refErr);

  const campaign = await createCampaignForUser(auth.session.userId, parsed.data);
  const view = await getCampaign(auth.session.userId, campaign._id.toString());
  return created(view);
}
