import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Client ----------------
/**
 * Clients are a shared directory: every signed-in user sees and can use the
 * same list. `userId` records who first added the row (provenance, and who to
 * ask about a duplicate) — it is deliberately NOT a visibility scope, so no
 * read or write path may filter by it. Campaigns stay per-user; only the
 * reference tables are global.
 */
export const clientSchema = new Schema(
  {
    name: { type: String, required: true },
    /** Creator. Provenance only — never a query scope. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
clientSchema.index({ name: 1 });

export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };

export const Client: Model<ClientDoc> =
  (mongoose.models.Client as Model<ClientDoc>) ??
  mongoose.model("Client", clientSchema);
