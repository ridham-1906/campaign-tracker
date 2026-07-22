import { z } from "zod";
import { ID } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { getBucketId, getStorage } from "@/lib/appwrite";
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_STAGES,
  validateAttachmentFile,
} from "@/lib/attachments";
import { findOwnedLocation } from "@/lib/services";
import { authGuard, badRequest, created, notFound } from "@/lib/api";
import type { AttachmentView } from "@/lib/data";

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

/** Upload one photo or document onto a location. Its own endpoint so a
 * single-file upload never has to resend the whole campaign form. */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId } = await params;

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");
  const { campaign, location } = found;

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
  const uploaded = await storage.createFile({
    bucketId,
    fileId: ID.unique(),
    file: InputFile.fromBuffer(await file.arrayBuffer(), file.name),
  });

  location.attachments.push({
    kind: parsed.data.kind,
    stage: parsed.data.kind === "image" ? parsed.data.stage : null,
    fileId: uploaded.$id,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
  } as never);

  try {
    await campaign.save();
  } catch (err) {
    // Don't leave an orphaned blob behind if the metadata write failed.
    await storage
      .deleteFile({ bucketId, fileId: uploaded.$id })
      .catch(() => {});
    throw err;
  }

  const saved = location.attachments[location.attachments.length - 1];
  const view: AttachmentView = {
    id: String(saved._id),
    kind: saved.kind as AttachmentView["kind"],
    stage: (saved.stage ?? null) as AttachmentView["stage"],
    filename: saved.filename,
    mimeType: saved.mimeType,
    size: saved.size,
    uploadedAt: new Date(saved.uploadedAt ?? Date.now()).toISOString(),
    url: `/api/campaigns/${id}/locations/${locationId}/attachments/${String(saved._id)}`,
  };
  return created(view);
}
