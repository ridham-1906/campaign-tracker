import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import {
  authGuard,
  badRequest,
  created,
  ok,
  readJson,
  serializeNamed,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  await connectDB();
  const rows = await Vendor.find({ userId: auth.session.userId })
    .sort({ name: 1 })
    .lean();
  return ok(rows.map(serializeNamed));
}

export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  await connectDB();
  const doc = await Vendor.create({
    ...parsed.data,
    userId: auth.session.userId,
  });
  return created(serializeNamed(doc));
}
