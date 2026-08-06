import { z } from "zod";
import { getOrCreateImageType } from "@/lib/services";
import { authGuard, badRequest, created, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().trim().min(1) });

/**
 * The "+ Add custom type" flow in the type-of-image picker. Idempotent by
 * name — see getOrCreateImageType — so retyping an existing name selects it
 * rather than creating a duplicate.
 */
export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const doc = await getOrCreateImageType(auth.session.userId, parsed.data.name);
  return created({ id: String(doc._id), name: doc.name, role: doc.role ?? null });
}
