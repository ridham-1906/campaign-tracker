import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Sales } from "@/models";
import {
  authGuard,
  badRequest,
  conflict,
  notFound,
  ok,
  readJson,
  serializeSales,
} from "@/lib/api";
import { countCampaignsUsing, isValidId } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

type Params = { params: Promise<{ id: string }> };

/** Shared directory — no owner scoping. See api/clients/[id] for the rationale. */
export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Sales person not found");

  await connectDB();
  const doc = await Sales.findById(id).lean();
  if (!doc) return notFound("Sales person not found");
  return ok(serializeSales(doc));
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Sales person not found");

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  await connectDB();
  const doc = await Sales.findByIdAndUpdate(id, parsed.data, {
    new: true,
  }).lean();
  if (!doc) return notFound("Sales person not found");
  return ok(serializeSales(doc));
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Sales person not found");

  const inUse = await countCampaignsUsing("salesId", id);
  if (inUse > 0) {
    return conflict(`In use by ${inUse} campaign(s); reassign or delete them first`);
  }

  await connectDB();
  const doc = await Sales.findByIdAndDelete(id);
  if (!doc) return notFound("Sales person not found");
  return ok({ ok: true, id });
}
