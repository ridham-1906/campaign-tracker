import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Vendor ----------------
export const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
vendorSchema.index({ userId: 1, name: 1 });

export type VendorDoc = InferSchemaType<typeof vendorSchema> & { _id: Types.ObjectId };

export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ??
  mongoose.model("Vendor", vendorSchema);
