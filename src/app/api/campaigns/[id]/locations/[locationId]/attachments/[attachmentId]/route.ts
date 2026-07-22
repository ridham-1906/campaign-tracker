import { getBucketId, getStorage } from "@/lib/appwrite";
import { findOwnedLocation } from "@/lib/services";
import { authGuard, notFound, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locationId: string; attachmentId: string }> };

/** View/download a single attachment. Streamed through us — the browser
 * never talks to Appwrite directly, same as every other read in this app. */
export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId, attachmentId } = await params;

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");

  const attachment = found.location.attachments.find(
    (a) => String(a._id) === attachmentId,
  );
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
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

/** Remove an attachment. The Mongo metadata is the source of truth for the
 * UI, so it's deleted first; the Appwrite file is then best-effort deleted —
 * an orphaned blob nobody can see is a far smaller problem than an
 * attachment the user can never remove. */
export async function DELETE(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId, attachmentId } = await params;

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");
  const { campaign, location } = found;

  const attachment = location.attachments.find(
    (a) => String(a._id) === attachmentId,
  );
  if (!attachment) return notFound("Attachment not found");

  const fileId = attachment.fileId;
  location.attachments = location.attachments.filter(
    (a) => String(a._id) !== attachmentId,
  ) as typeof location.attachments;
  await campaign.save();

  try {
    await getStorage().deleteFile({ bucketId: getBucketId(), fileId });
  } catch (err) {
    console.error(`Appwrite delete failed for file ${fileId}:`, err);
  }

  return ok({ ok: true, id: attachmentId });
}
