import { getUserList } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The backend users, for the dashboard's "Backend" filter.
 *
 * Session-guarded, unlike its parent route's REGISTER_SECRET-gated user
 * provisioning: this returns names only, which the dashboard's Backend column
 * already shows to every signed-in user.
 */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(await getUserList());
}
