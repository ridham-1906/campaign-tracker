import { getSharePreview } from "@/lib/share";
import { notFound, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * The public preview payload. No session — the token in the path is the
 * credential, and it only ever resolves to the one campaign it was minted for.
 * Never expires, so an unknown token means deleted or mistyped, not stale.
 */
export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;
  const preview = await getSharePreview(token);
  if (!preview) return notFound("This preview link is no longer available");

  return ok(preview);
}
