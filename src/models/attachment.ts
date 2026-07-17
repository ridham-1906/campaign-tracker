import "server-only";
import { Schema, Types, InferSchemaType } from "mongoose";
import { ATTACHMENT_KINDS, ATTACHMENT_STAGES } from "@/lib/attachments";

// ---------------- Attachment ----------------
/**
 * Metadata only — the binary lives in Appwrite Storage, keyed by `fileId`.
 * `stage` is set for images (installation/mid_date/end_date) and left null
 * for documents (creative decks), which aren't tied to a lifecycle stage.
 */
export const attachmentSchema = new Schema({
  kind: { type: String, enum: ATTACHMENT_KINDS, required: true },
  stage: { type: String, enum: ATTACHMENT_STAGES, default: null },
  fileId: { type: String, required: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

export type AttachmentDoc = InferSchemaType<typeof attachmentSchema> & {
  _id: Types.ObjectId;
};
