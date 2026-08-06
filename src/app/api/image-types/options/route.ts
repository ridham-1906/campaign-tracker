import { getImageTypeOptions } from "@/lib/data";
import { authGuard, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The full list for the "type of image" picker — seeded with the three
 * canonical stages the first time this user touches it. */
export async function GET() {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  return ok(await getImageTypeOptions(auth.session.userId));
}
