import { z } from "zod";
import { getBucketId, getStorage, verifyUploadTicket } from "@/lib/appwrite";
import { validateAttachmentMeta } from "@/lib/attachments";
import { deleteAttachmentsFor, findOwnedLocation, isValidId } from "@/lib/services";
import { attachmentViewFrom } from "@/lib/data";
import { Attachment, ImageType } from "@/models";
import {
  authGuard,
  badRequest,
  conflict,
  created,
  notFound,
  ok,
  readJson,
} from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locationId: string }> };

const registerSchema = z.object({
  ticket: z.string().min(1),
  fileId: z.string().min(1).max(36),
});

/** Omit `ids` to clear every attachment on the location. */
const deleteSchema = z.object({
  ids: z.array(z.string().refine(isValidId, "Invalid attachment id")).optional(),
});

/**
 * Register a file the browser has just uploaded straight to Appwrite.
 *
 * This used to take the file itself as multipart, which Vercel caps at ~4.5MB —
 * well under our own limits, so any large photo failed at the edge before the
 * handler ran. The bytes now go browser → Appwrite (see ./upload-ticket) and
 * only this small metadata write comes back to us.
 *
 * Nothing here is taken on trust: the kind and image type come from the signed
 * ticket, and the filename, mime type and size are read back from Appwrite
 * rather than accepted from the caller.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId } = await params;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = registerSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const ticket = await verifyUploadTicket(parsed.data.ticket);
  if (!ticket) return badRequest("Upload ticket is invalid or has expired");

  // The ticket is bound to one user, one location and one set of file ids, so
  // a valid ticket can't be replayed against a different location or used to
  // claim a blob it didn't cover.
  if (
    ticket.userId !== auth.session.userId ||
    ticket.campaignId !== id ||
    ticket.locationId !== locationId ||
    !ticket.fileIds.includes(parsed.data.fileId)
  ) {
    return badRequest("Upload ticket does not cover this file");
  }

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");

  // A retried registration must not insert the same blob twice; `fileId` has
  // no unique index to fall back on.
  if (await Attachment.exists({ fileId: parsed.data.fileId })) {
    return conflict("This file has already been registered");
  }

  const storage = getStorage();
  const bucketId = getBucketId();
  let stored;
  try {
    stored = await storage.getFile({ bucketId, fileId: parsed.data.fileId });
  } catch {
    return badRequest("Upload not found — the file was never finished");
  }

  const fileErr = validateAttachmentMeta(
    ticket.kind,
    stored.mimeType,
    stored.sizeOriginal,
  );
  if (fileErr) {
    await storage.deleteFile({ bucketId, fileId: parsed.data.fileId }).catch(() => {});
    return badRequest(fileErr);
  }

  // Resolved here rather than trusted from the ticket: its `role` becomes the
  // derived `stage`, and its name goes straight into the response so the UI
  // doesn't need a refetch to show what was just added.
  let imageType: InstanceType<typeof ImageType> | null = null;
  if (ticket.kind === "image") {
    imageType = await ImageType.findOne({
      _id: ticket.imageTypeId,
      userId: auth.session.userId,
    });
    if (!imageType) return badRequest("Invalid image type");
  }

  let saved;
  try {
    saved = await Attachment.create({
      userId: auth.session.userId,
      campaignId: found.campaign._id,
      locationId: found.location._id,
      // Stamped at upload time, not read through the campaign later: renewing
      // moves the campaign on to the next term, and this photo documents the
      // one it was actually taken under.
      term: found.campaign.term ?? 1,
      kind: ticket.kind,
      stage: imageType?.role ?? null,
      imageTypeId: imageType?._id ?? null,
      photoType: ticket.kind === "image" ? ticket.photoType : null,
      fileId: stored.$id,
      filename: stored.name,
      mimeType: stored.mimeType,
      size: stored.sizeOriginal,
    });
  } catch (err) {
    // Don't leave an orphaned blob behind if the metadata write failed.
    await storage.deleteFile({ bucketId, fileId: stored.$id }).catch(() => {});
    throw err;
  }

  const imageTypeById = imageType
    ? new Map([[String(imageType._id), imageType.name]])
    : undefined;
  return created(attachmentViewFrom(saved, id, locationId, imageTypeById));
}

/**
 * Delete several attachments at once — `{ ids: [...] }`, or no body to clear
 * the whole location.
 *
 * One request rather than one per file: every request pays a full getSession(),
 * which hits Mongo to confirm the user still exists, so a 20-file delete over
 * the single-attachment route was 20 auth round-trips. This is one auth check,
 * one deleteMany, and the Appwrite deletes fanned out in parallel.
 *
 * Returns the ids actually removed so the client can drop exactly those.
 */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId } = await params;

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");

  // No body means "everything on this location" — tolerated rather than a 400,
  // since DELETE with an empty body is a reasonable thing for a client to send.
  const body = await req
    .clone()
    .text()
    .then((t) => t.trim());
  let ids: string[] | undefined;
  if (body) {
    const parsed = await readJson(req);
    if ("error" in parsed) return parsed.error;
    const fields = deleteSchema.safeParse(parsed.data);
    if (!fields.success) {
      return badRequest("Validation failed", fields.error.issues);
    }
    ids = fields.data.ids;
  }

  const deletedIds = await deleteAttachmentsFor({
    campaignId: id,
    locationIds: [locationId],
    attachmentIds: ids,
    userId: auth.session.userId,
  });

  return ok({ ok: true, deletedIds });
}
