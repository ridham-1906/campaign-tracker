import { getBucketId, getStorage } from "@/lib/appwrite";
import { findSharedAttachment } from "@/lib/share";
import { isValidId } from "@/lib/services";
import { notFound } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string; attachmentId: string }> };

/**
 * Stream one file behind a preview link — the public twin of the session-gated
 * attachment route. Still proxied through us rather than handing out an
 * Appwrite URL, so the token stays the only way in and can be revoked by
 * deleting the share.
 *
 * These URLs also appear as `<img src>` inside the notification email, so the
 * response has to be plainly cacheable by a mail client's image proxy — but
 * `private` keeps shared caches out of it, since the path carries the secret.
 */
export async function GET(_req: Request, { params }: Params) {
  const { token, attachmentId } = await params;
  if (!isValidId(attachmentId)) return notFound("Attachment not found");

  const attachment = await findSharedAttachment(token, attachmentId);
  if (!attachment) return notFound("Attachment not found");

  let bytes: ArrayBuffer;
  try {
    bytes = await getStorage().getFileView({
      bucketId: getBucketId(),
      fileId: attachment.fileId,
    });
  } catch {
    return notFound("File not found");
  }

  return new Response(bytes, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename)}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=600",
    },
  });
}
