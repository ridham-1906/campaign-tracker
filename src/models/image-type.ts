import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";
import { ATTACHMENT_STAGES } from "@/lib/attachments";

// ---------------- ImageType ----------------
/**
 * What an uploaded photo is showing, per location-lifecycle stage — user
 * managed, unlike the fixed photoType (newspaper/long shot/close shot/gps).
 * Every user gets the three canonical stages seeded on first access (see
 * getImageTypeOptions in lib/data.ts); `role` ties a seeded type back to the
 * fixed stage it represents, so stage-dependent logic (the PPT export's
 * Start/Mid/End Date labeling) keeps working. A custom type a user adds
 * inline has no role.
 */
export const imageTypeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    role: { type: String, enum: ATTACHMENT_STAGES, default: null },
  },
  { timestamps: true },
);

imageTypeSchema.index({ userId: 1, name: 1 });

export type ImageTypeDoc = InferSchemaType<typeof imageTypeSchema> & {
  _id: Types.ObjectId;
};

export const ImageType: Model<ImageTypeDoc> =
  (mongoose.models.ImageType as Model<ImageTypeDoc>) ??
  mongoose.model("ImageType", imageTypeSchema, "image_type");
