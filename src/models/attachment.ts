import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";
import { ATTACHMENT_KINDS, ATTACHMENT_STAGES, PHOTO_TYPES } from "@/lib/attachments";

// ---------------- Attachment ----------------
/**
 * Metadata only — the binary lives in Appwrite Storage, keyed by `fileId`.
 * `stage` is set for images (installation/mid_date/end_date) and left null
 * for documents (creative decks), which aren't tied to a lifecycle stage.
 *
 * A standalone collection rather than a subdocument of a campaign's location.
 * Embedding meant the images screen had to $unwind every campaign to page
 * over files, the campaign list carried metadata it never renders, and each
 * single-file upload rewrote the entire campaign document.
 */
export const attachmentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
  /**
   * The _id of the embedded location subdocument. Safe as a foreign key:
   * updateCampaignForUser() reconciles the locations array in place —
   * filtering to kept ids and Object.assign-ing onto the existing subdoc —
   * so a location's _id survives edits.
   */
  locationId: { type: Schema.Types.ObjectId, required: true },
  /**
   * The campaign's `term` at upload time — which booking period this photo
   * documents. Renewing a campaign no longer clones it, so without this every
   * term's installation shots would pile into one undifferentiated gallery.
   * Defaults to 1, which is exactly right for everything uploaded before
   * renewals were tracked.
   */
  term: { type: Number, default: 1 },

  kind: { type: String, enum: ATTACHMENT_KINDS, required: true },
  // `stage` is derived from imageTypeId's role at write time (installation/
  // mid_date/end_date for the three canonical types, null for a custom one)
  // and kept as its own field so stage-dependent logic (browsing buckets, the
  // PPT export's Start/Mid/End Date labeling) doesn't need to join through
  // ImageType on every read.
  stage: { type: String, enum: ATTACHMENT_STAGES, default: null },
  // The user-managed type this photo was tagged with — see models/image-type.ts.
  imageTypeId: { type: Schema.Types.ObjectId, ref: "ImageType", default: null },
  // Set for images only, alongside `stage` — what the photo actually shows.
  photoType: { type: String, enum: PHOTO_TYPES, default: null },
  fileId: { type: String, required: true },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

// The images list, which groups a user's files by campaign. Holding uploadedAt
// keeps its $max covered, so the group never fetches a document.
attachmentSchema.index({ userId: 1, campaignId: 1, uploadedAt: -1 });
// The campaign detail view, and both cascade-delete paths. `term` rides along
// so the per-term gallery filter is covered by the same index.
attachmentSchema.index({ campaignId: 1, locationId: 1, term: 1 });

export type AttachmentDoc = InferSchemaType<typeof attachmentSchema> & {
  _id: Types.ObjectId;
};

export const Attachment: Model<AttachmentDoc> =
  (mongoose.models.Attachment as Model<AttachmentDoc>) ??
  mongoose.model("Attachment", attachmentSchema);
