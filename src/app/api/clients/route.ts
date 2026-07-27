import { z } from "zod";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Client } from "@/models";
import { ENTITY_SORT_KEYS, getClientsPage } from "@/lib/data";
import {
  authGuard,
  badRequest,
  created,
  ok,
  parseListParams,
  readJson,
  serializeNamed,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({ name: z.string().min(1) });

/**
 * Paginated, with campaign-usage counts for the rows on this page.
 * Returns the `{rows,total,page,limit}` envelope — this used to be a bare
 * array; see doc/rest-api.md.
 */
export async function GET(req: NextRequest) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const params = parseListParams(req.nextUrl.searchParams, {
    sortKeys: ENTITY_SORT_KEYS,
    defaultSort: "name",
  });
  return ok(await getClientsPage(auth.session.userId, params));
}

export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  await connectDB();
  const doc = await Client.create({
    ...parsed.data,
    userId: auth.session.userId,
  });
  return created(serializeNamed(doc));
}
