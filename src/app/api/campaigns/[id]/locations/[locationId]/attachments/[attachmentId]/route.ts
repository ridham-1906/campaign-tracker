import { z } from "zod";
import { NextResponse } from "next/server";
import { createFileViewUrl, getBucketId, getStorage } from "@/lib/appwrite";
import { isValidId } from "@/lib/services";
import { connectDB } from "@/lib/db";
import { Attachment, ImageType } from "@/models";
import { PHOTO_TYPES } from "@/lib/attachments";
import { attachmentViewFrom } from "@/lib/data";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string; locationId: string; attachmentId: string }>;
};

const patchSchema = z
  .object({
    imageTypeId: z.string().refine(isValidId, "Invalid image type").optional(),
    photoType: z.enum(PHOTO_TYPES).optional(),
  })
  .refine((d) => d.imageTypeId !== undefined || d.photoType !== undefined, {
    message: "Provide imageTypeId and/or photoType to update",
  });

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

/**
 * View/download a single attachment.
 *
 * The ownership check still happens here, but the bytes no longer do: this used
 * to buffer the whole blob and return it, which Vercel caps at ~4.5MB per
 * response — so a large photo could be stored and then never shown. We redirect
 * to a short-lived Appwrite file token instead, and the browser fetches it
 * directly. That means Appwrite must list this app's domains as web platforms,
 * since the gallery, ZIP download and PPT export now read cross-origin.
 */
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

  let url: string;
  try {
    url = await createFileViewUrl(attachment.fileId);
  } catch {
    return notFound("File not found");
  }

  const res = NextResponse.redirect(url, 307);
  // Well inside the token's own hour, so a cached redirect can never outlive
  // the token it points at — and a 50-thumbnail gallery doesn't mint 50 tokens
  // on every render.
  res.headers.set("Cache-Control", "private, max-age=600");
  return res;
}

/** Reclassify an image's stage and/or photo type after the fact — the
 * original pick at upload time isn't always right. Documents have neither
 * field, so they're rejected rather than silently ignored. */
export async function PATCH(req: Request, { params }: Params) {
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
  if (attachment.kind !== "image") {
    return badRequest("Only image attachments have a stage or photo type");
  }

  const parsed = await readJson(req);
  if ("error" in parsed) return parsed.error;
  const fields = patchSchema.safeParse(parsed.data);
  if (!fields.success) {
    return badRequest("Validation failed", fields.error.issues);
  }

  let imageType: InstanceType<typeof ImageType> | null = null;
  if (fields.data.imageTypeId !== undefined) {
    imageType = await ImageType.findOne({
      _id: fields.data.imageTypeId,
      userId: auth.session.userId,
    });
    if (!imageType) return badRequest("Invalid image type");
    attachment.stage = imageType.role ?? null;
    attachment.imageTypeId = imageType._id;
  }
  if (fields.data.photoType !== undefined) {
    attachment.photoType = fields.data.photoType;
  }
  await attachment.save();

  // A photoType-only patch doesn't touch imageTypeId, but the response should
  // still reflect whatever image type the attachment already had.
  if (!imageType && attachment.imageTypeId) {
    imageType = await ImageType.findOne({
      _id: attachment.imageTypeId,
      userId: auth.session.userId,
    });
  }
  const imageTypeById = imageType
    ? new Map([[String(imageType._id), imageType.name]])
    : undefined;
  return ok(attachmentViewFrom(attachment, id, locationId, imageTypeById));
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
