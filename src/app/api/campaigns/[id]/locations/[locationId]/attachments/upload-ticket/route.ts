import { z } from "zod";
import { ID } from "node-appwrite";
import { getAppwriteConfig, mintUploadJwt, signUploadTicket } from "@/lib/appwrite";
import { ATTACHMENT_KINDS, PHOTO_TYPES } from "@/lib/attachments";
import { findOwnedLocation, isValidId } from "@/lib/services";
import { ImageType } from "@/models";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; locationId: string }> };

/** One ticket covers one dialog's worth of files. */
const MAX_BATCH = 50;

const ticketSchema = z
  .object({
    kind: z.enum(ATTACHMENT_KINDS),
    imageTypeId: z.string().refine(isValidId, "Invalid image type").optional(),
    photoType: z.enum(PHOTO_TYPES).optional(),
    count: z.number().int().min(1).max(MAX_BATCH),
  })
  .refine((d) => d.kind !== "image" || Boolean(d.imageTypeId), {
    message: "imageTypeId is required for image attachments",
    path: ["imageTypeId"],
  })
  .refine((d) => d.kind !== "image" || Boolean(d.photoType), {
    message: "photoType is required for image attachments",
    path: ["photoType"],
  });

/**
 * Authorise a batch of direct-to-Appwrite uploads.
 *
 * Vercel caps a function's request body at ~4.5MB, far below our own file
 * limits, so the bytes can't come through us. Instead this does every check the
 * old multipart route did up front — ownership, kind, image type — mints a
 * create-only Appwrite JWT, and signs the file ids it just generated into a
 * ticket. The browser uploads with the JWT, then posts the ticket back to
 * ../attachments to register each file it stored.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id, locationId } = await params;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = ticketSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const found = await findOwnedLocation(auth.session.userId, id, locationId);
  if (!found) return notFound("Location not found");

  if (parsed.data.kind === "image") {
    const exists = await ImageType.exists({
      _id: parsed.data.imageTypeId,
      userId: auth.session.userId,
    });
    if (!exists) return badRequest("Invalid image type");
  }

  // Generated here, never accepted from the client — the register route only
  // honours an id it finds in this signed list.
  const fileIds = Array.from({ length: parsed.data.count }, () => ID.unique());

  const { endpoint, projectId, bucketId } = getAppwriteConfig();
  const { jwt, expiresAt } = await mintUploadJwt();
  const ticket = await signUploadTicket({
    userId: auth.session.userId,
    campaignId: id,
    locationId,
    kind: parsed.data.kind,
    imageTypeId: parsed.data.imageTypeId,
    photoType: parsed.data.photoType,
    fileIds,
  });

  return ok({ endpoint, projectId, bucketId, jwt, ticket, fileIds, expiresAt });
}
