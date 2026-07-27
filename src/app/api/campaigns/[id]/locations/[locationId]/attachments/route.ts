import { z } from "zod";
import { ID } from "node-appwrite";
import { getBucketId, getStorage } from "@/lib/appwrite";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_STAGES,
  validateAttachmentFile,
} from "@/lib/attachments";
import { deleteAttachmentsFor, findOwnedLocation, isValidId } from "@/lib/services";
import { attachmentViewFrom } from "@/lib/data";
import { Attachment } from "@/models";
import { authGuard, badRequest, created, notFound, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locationId: string }> };

const fieldsSchema = z
  .object({
    kind: z.enum(ATTACHMENT_KINDS),
    stage: z.enum(ATTACHMENT_STAGES).optional(),
  })
  .refine((d) => d.kind !== "image" || Boolean(d.stage), {
    message: "stage is required for image attachments",
    path: ["stage"],
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
    stage: formData.get("stage") ?? undefined,
  });
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const fileErr = validateAttachmentFile(parsed.data.kind, file);
  if (fileErr) return badRequest(fileErr);

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
      stage: parsed.data.kind === "image" ? parsed.data.stage : null,
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

  return created(attachmentViewFrom(saved, id, locationId));
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
