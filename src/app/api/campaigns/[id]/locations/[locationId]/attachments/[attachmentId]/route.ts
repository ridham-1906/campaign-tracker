import { getBucketId, getStorage } from "@/lib/appwrite";
import { isValidId } from "@/lib/services";
import { connectDB } from "@/lib/db";
import { Attachment } from "@/models";
import { authGuard, notFound, ok } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; locationId: string; attachmentId: string }>;
};

/**
 * Attachments live in their own collection now, so ownership is a single
 * scoped lookup rather than loading the campaign and scanning its locations.
 * campaignId/locationId stay in the filter so a valid attachment id from
 * another location can't be read through this route's path.
 */
async function findOwned(
  userId: string,
  campaignId: string,
  locationId: string,
  attachmentId: string,
) {
  if (![campaignId, locationId, attachmentId].every(isValidId)) return null;
  await connectDB();
  return Attachment.findOne({
    _id: attachmentId,
    userId,
    campaignId,
    locationId,
  });
}

/** View/download a single attachment. Streamed through us — the browser
 * never talks to Appwrite directly, same as every other read in this app. */
export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId, attachmentId } = await params;

  const attachment = await findOwned(
    auth.session.userId,
    id,
    locationId,
    attachmentId,
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

  const attachment = await findOwned(
    auth.session.userId,
    id,
    locationId,
    attachmentId,
  );
  if (!attachment) return notFound("Attachment not found");

  const { fileId } = attachment;
  await attachment.deleteOne();

  try {
    await getStorage().deleteFile({ bucketId: getBucketId(), fileId });
  } catch (err) {
    console.error(`Appwrite delete failed for file ${fileId}:`, err);
  }

  return ok({ ok: true, id: attachmentId });
}
