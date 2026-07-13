import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the currently authenticated user (from the session cookie). */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(auth.session);
}
