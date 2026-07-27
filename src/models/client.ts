import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Client ----------------
export const clientSchema = new Schema(
  {
    name: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
clientSchema.index({ userId: 1, name: 1 });

export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };

export const Client: Model<ClientDoc> =
  (mongoose.models.Client as Model<ClientDoc>) ??
  mongoose.model("Client", clientSchema);
