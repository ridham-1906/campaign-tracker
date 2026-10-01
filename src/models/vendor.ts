import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Vendor ----------------
/** A shared directory, like Client — see the note in models/client.ts. */
export const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    /**
     * Where a "Remind vendor" send from the campaign screen goes. Empty means
     * the vendor can't be emailed — see lib/reminders/vendor.ts. There is no
     * stored schedule: every vendor email is triggered on demand, not by a
     * date picked here.
     */
    emails: { type: [String], default: [] },
    /** Creator. Provenance only — never a query scope. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
vendorSchema.index({ name: 1 });

export type VendorDoc = InferSchemaType<typeof vendorSchema> & { _id: Types.ObjectId };

// A hot reload keeps the previously compiled model, and strict mode then
// silently drops any field added to the schema since — saves "succeed"
// without them. Recompile when the cached model predates `emails`.
if (mongoose.models.Vendor && !mongoose.models.Vendor.schema.path("emails")) {
  mongoose.deleteModel("Vendor");
}

export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ??
  mongoose.model("Vendor", vendorSchema);
