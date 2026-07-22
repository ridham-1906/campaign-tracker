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

export type SalesDoc = InferSchemaType<typeof salesSchema> & { _id: Types.ObjectId };

export const Sales: Model<SalesDoc> =
  (mongoose.models.Sales as Model<SalesDoc>) ??
  mongoose.model("Sales", salesSchema);
