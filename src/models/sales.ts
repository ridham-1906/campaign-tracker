import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Sales ----------------
export const salesSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
salesSchema.index({ userId: 1, name: 1 });

export type SalesDoc = InferSchemaType<typeof salesSchema> & { _id: Types.ObjectId };

export const Sales: Model<SalesDoc> =
  (mongoose.models.Sales as Model<SalesDoc>) ??
  mongoose.model("Sales", salesSchema);
