import { getClientList } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The complete list, for comboboxes that need every option to resolve a
 * selected id. A separate route rather than `?all=1` on the paginated list:
 * one response shape per route, so callers never have to narrow
 * `Option[] | Page<Option>`, and there's no way to accidentally pull an
 * unbounded list through the paginated path.
 */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(await getClientList(auth.session.userId));
}
