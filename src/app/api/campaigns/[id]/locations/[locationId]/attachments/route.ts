import { z } from "zod";
import { ID } from "node-appwrite";
import { getBucketId, getStorage } from "@/lib/appwrite";
import { ATTACHMENT_KINDS, PHOTO_TYPES, validateAttachmentFile } from "@/lib/attachments";
import { deleteAttachmentsFor, findOwnedLocation, isValidId } from "@/lib/services";
import { attachmentViewFrom } from "@/lib/data";
import { Attachment, ImageType } from "@/models";
import { authGuard, badRequest, created, notFound, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locationId: string }> };

const fieldsSchema = z
  .object({
    kind: z.enum(ATTACHMENT_KINDS),
    imageTypeId: z.string().refine(isValidId, "Invalid image type").optional(),
    photoType: z.enum(PHOTO_TYPES).optional(),
  })
  .refine((d) => d.kind !== "image" || Boolean(d.imageTypeId), {
    message: "imageTypeId is required for image attachments",
    path: ["imageTypeId"],
  })
  .refine((d) => d.kind !== "image" || Boolean(d.photoType), {
    message: "photoType is required for image attachments",
    path: ["photoType"],
  });

/** Omit `ids` to clear every attachment on the location. */
const deleteSchema = z.object({
  ids: z.array(z.string().refine(isValidId, "Invalid attachment id")).optional(),
});

/** Upload one photo or document onto a location. Its own endpoint so a
 * single-file upload never has to resend the whole campaign form. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId } = await params;

  // Still the ownership check, even though the write no longer touches the
  // campaign document — it proves the (campaign, location) pair is the
  // caller's before anything is stored against it.
  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("Invalid form data");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return badRequest("Missing file");

  const parsed = fieldsSchema.safeParse({
    kind: formData.get("kind"),
    imageTypeId: formData.get("imageTypeId") ?? undefined,
    photoType: formData.get("photoType") ?? undefined,
  });
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const fileErr = validateAttachmentFile(parsed.data.kind, file);
  if (fileErr) return badRequest(fileErr);

  // Resolved once up front: its `role` becomes the derived `stage`, and its
  // name goes straight into the response so the UI doesn't need a refetch to
  // show what was just picked.
  let imageType: InstanceType<typeof ImageType> | null = null;
  if (parsed.data.kind === "image") {
    imageType = await ImageType.findOne({
      _id: parsed.data.imageTypeId,
      userId: auth.session.userId,
    });
    if (!imageType) return badRequest("Invalid image type");
  }

  const storage = getStorage();
  const bucketId = getBucketId();
  // Hand the request's own `File` to the SDK rather than wrapping it in
  // `InputFile`: the SDK's uploader recognises the payload via `instanceof`,
  // and the bundler resolves `node-appwrite/file` to a different module copy
  // than the one `node-appwrite` itself loads, so an `InputFile` fails that
  // check with "File not found in payload". `File` is the global in both.
  const uploaded = await storage.createFile({
    bucketId,
    fileId: ID.unique(),
    file,
  });

  let saved;
  try {
    // One small insert. This used to push onto the embedded array and then
    // campaign.save(), rewriting the whole campaign document per file.
    saved = await Attachment.create({
      userId: auth.session.userId,
      campaignId: found.campaign._id,
      locationId: found.location._id,
      kind: parsed.data.kind,
      stage: imageType?.role ?? null,
      imageTypeId: imageType?._id ?? null,
      photoType: parsed.data.kind === "image" ? parsed.data.photoType : null,
      fileId: uploaded.$id,
      filename: file.name,
      mimeType: file.type,
      size: file.size,
    });
  } catch (err) {
    // Don't leave an orphaned blob behind if the metadata write failed.
    await storage.deleteFile({ bucketId, fileId: uploaded.$id }).catch(() => {});
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
