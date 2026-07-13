import { z } from "zod";
import { getCampaign } from "@/lib/data";
import {
  deleteCampaignForUser,
  isValidId,
  updateCampaignForUser,
  validateRefsOwned,
} from "@/lib/services";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    salesId: z.string().min(1).optional(),
    vendorId: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    status: z.enum(["LIVE", "ENDED"]).optional(),
    reminderDate: z.coerce.date().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "No fields to update",
  })
  .refine((d) => !(d.startDate && d.endDate) || d.endDate >= d.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const view = await getCampaign(auth.session.userId, id);
  if (!view) return notFound("Campaign not found");
  return ok(view);
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  // Validate any referenced people that are being changed belong to the user.
  const d = parsed.data;
  if (d.salesId || d.vendorId || d.clientId) {
    const current = await getCampaign(auth.session.userId, id);
    if (!current) return notFound("Campaign not found");
    const refErr = await validateRefsOwned(auth.session.userId, {
      salesId: d.salesId ?? current.sales.id,
      vendorId: d.vendorId ?? current.vendor.id,
      clientId: d.clientId ?? current.client.id,
    });
    if (refErr) return badRequest(refErr);
  }

  const updated = await updateCampaignForUser(auth.session.userId, id, d);
  if (!updated) return notFound("Campaign not found");

  const view = await getCampaign(auth.session.userId, id);
  return ok(view);
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const deleted = await deleteCampaignForUser(auth.session.userId, id);
  if (!deleted) return notFound("Campaign not found");
  return ok({ ok: true, id });
}
