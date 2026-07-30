import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession, type SessionPayload } from "@/lib/auth";
import type { Page } from "@/lib/view-types";

// ---- JSON response helpers ----
export const ok = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export const created = (data: unknown) => NextResponse.json(data, { status: 201 });

export const badRequest = (error: string, issues?: unknown) =>
  NextResponse.json(issues ? { error, issues } : { error }, { status: 400 });

export const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export const notFound = (error = "Not found") =>
  NextResponse.json({ error }, { status: 404 });

export const conflict = (error: string) =>
  NextResponse.json({ error }, { status: 409 });

/** Read+auth guard for API routes. Returns the session or a 401 response. */
export async function authGuard(): Promise<
  { session: SessionPayload } | { error: NextResponse }
> {
  const session = await getSession();
  if (!session) return { error: unauthorized() };
  return { session };
}

/**
 * The `userId` to scope a read query by — `null` for an admin session, which
 * every read layer function (see lib/data.ts) treats as "every user". Writes
 * never go through this: create/edit/delete routes always pass
 * `session.userId` directly, so an admin only ever writes their own data.
 */
export function readScope(session: SessionPayload): string | null {
  return session.isAdmin ? null : session.userId;
}

/**
 * Guard for the cron routes, which authenticate with a shared secret rather
 * than a session. Prefer the Authorization header; the query string is a
 * fallback for schedulers that can't set headers, and shows up in logs.
 */
export function cronGuard(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? req.nextUrl.searchParams.get("secret");

  return provided === secret ? null : unauthorized();
}

/** Parse a JSON body, returning a 400 response on malformed input. */
export async function readJson(
  req: Request,
): Promise<{ data: unknown } | { error: NextResponse }> {
  try {
    return { data: await req.json() };
  } catch {
    return { error: badRequest("Invalid JSON body") };
  }
}

// ---- List query params ----

export type ListParams<S extends string = string> = {
  page: number;
  limit: number;
  /** Derived from page/limit so callers never recompute it. */
  skip: number;
  q?: string;
  sort: S;
  /** Mongo sort direction, ready to spread into a $sort stage. */
  dir: 1 | -1;
};

/** Accepts a route handler's URLSearchParams or a page's awaited searchParams. */
type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(src: RawParams, key: string): string | undefined {
  if (src instanceof URLSearchParams) return src.get(key) ?? undefined;
  const v = src[key];
  return Array.isArray(v) ? v[0] : v;
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escape user input before it reaches a $regex. Unescaped, a stray `(` throws,
 * `.*` matches everything, and nested quantifiers are a CPU DoS vector.
 */
export function escapeRegex(s: string) {
  return s.replace(REGEX_SPECIALS, "\\$&");
}

export function searchRegex(q: string) {
  return new RegExp(escapeRegex(q), "i");
}

/**
 * `.catch()` rather than strict parsing throughout: a stale bookmark or a
 * hand-edited query string should fall back to page 1, never 400.
 */
const paramsSchema = (maxLimit: number, defaultLimit: number) =>
  z.object({
    page: z.coerce.number().int().min(1).catch(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).catch(defaultLimit),
    // Bounded as a second line of defence behind escapeRegex().
    q: z.string().trim().min(1).max(100).optional().catch(undefined),
    dir: z.enum(["asc", "desc"]).catch("asc"),
  });

export function parseListParams<S extends string>(
  raw: RawParams,
  opts: {
    /**
     * Allow-list of sortable keys. This is a security control, not ergonomics:
     * `sort` is interpolated straight into a $sort key.
     */
    sortKeys: readonly S[];
    defaultSort: S;
    defaultDir?: "asc" | "desc";
    defaultLimit?: number;
    maxLimit?: number;
  },
): ListParams<S> {
  const { defaultLimit = 20, maxLimit = 100 } = opts;

  const parsed = paramsSchema(maxLimit, defaultLimit).parse({
    page: readParam(raw, "page"),
    limit: readParam(raw, "limit"),
    q: readParam(raw, "q"),
    dir: readParam(raw, "dir") ?? opts.defaultDir ?? "asc",
  });

  const rawSort = readParam(raw, "sort");
  const sort = (opts.sortKeys as readonly string[]).includes(rawSort ?? "")
    ? (rawSort as S)
    : opts.defaultSort;

  return {
    page: parsed.page,
    limit: parsed.limit,
    skip: (parsed.page - 1) * parsed.limit,
    q: parsed.q,
    sort,
    dir: parsed.dir === "desc" ? -1 : 1,
  };
}

/** Wrap rows in the standard list envelope. */
export function listResponse<T>(
  rows: T[],
  total: number,
  p: ListParams,
): Page<T> {
  return { rows, total, page: p.page, limit: p.limit };
}

// ---- Serializers (Mongoose lean docs -> plain JSON) ----
type Id = { toString(): string };

export function serializeSales(d: {
  _id: Id;
  name: string;
  email: string;
  createdAt?: Date;
}) {
  return {
    id: d._id.toString(),
    name: d.name,
    email: d.email,
    createdAt: d.createdAt,
  };
}

export function serializeNamed(d: { _id: Id; name: string; createdAt?: Date }) {
  return { id: d._id.toString(), name: d.name, createdAt: d.createdAt };
}

