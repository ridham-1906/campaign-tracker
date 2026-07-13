import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Sales } from "@/models";
import {
  authGuard,
  badRequest,
  created,
  ok,
  readJson,
  serializeSales,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  await connectDB();
  const rows = await Sales.find({ userId: auth.session.userId })
    .sort({ name: 1 })
    .lean();
  return ok(rows.map(serializeSales));
}

export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  await connectDB();
  const doc = await Sales.create({
    ...parsed.data,
    userId: auth.session.userId,
  });
  return created(serializeSales(doc));
}
