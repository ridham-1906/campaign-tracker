import { NextResponse } from "next/server";
import { createFileViewUrl } from "@/lib/appwrite";
import { findSharedAttachment } from "@/lib/share";
import { isValidId } from "@/lib/services";
import { notFound } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; attachmentId: string }> };

/** How long a minted Appwrite URL stays usable — and so, at worst, how long a
 * file remains reachable after its share is deleted. Kept short because this
 * route is public; the session-gated one can afford the default hour. */
const SHARE_TOKEN_SECONDS = 600;

/**
 * Redirect to one file behind a preview link — the public twin of the
 * session-gated attachment route. The share token is still the only way to get
 * here, but the bytes come from Appwrite rather than through us: buffering them
 * capped this route at Vercel's ~4.5MB response limit, so a large photo could
 * be uploaded and then never render in a shared preview.
 *
 * The tradeoff is that deleting a share no longer cuts access instantly — an
 * already-issued URL keeps working for SHARE_TOKEN_SECONDS.
 *
 * These URLs also appear as `<img src>` inside the notification email; mail
 * image proxies follow the redirect and cache the result, and `private` keeps
 * shared caches off the redirect itself, since the path carries the secret.
 *
 * `?download=1` asks Appwrite for an attachment disposition, which a link click
 * needs — `<a download>` stops applying across an origin change.
 */
export async function GET(req: Request, { params }: Params) {
  const { token, attachmentId } = await params;
  const asDownload =
    new URL(req.url).searchParams.get("download") === "1" ? "download" : "view";
  if (!isValidId(attachmentId)) return notFound("Attachment not found");

  const attachment = await findSharedAttachment(token, attachmentId);
  if (!attachment) return notFound("Attachment not found");

  let url: string;
  try {
    url = await createFileViewUrl(
      attachment.fileId,
      SHARE_TOKEN_SECONDS,
      asDownload,
    );
  } catch {
    return notFound("File not found");
  }

  const res = NextResponse.redirect(url, 307);
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}
