import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- Vendor ----------------
/** A shared directory, like Client — see the note in models/client.ts. */
export const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    /** Where vendor reminders go. Empty means the vendor is never emailed. */
    emails: { type: [String], default: [] },
    /**
     * Calendar days (UTC midnight, like every other date here) on which the
     * vendor is emailed about its live sites. Set per vendor, so the dates
     * apply to every campaign that uses it. See lib/reminders/vendor.ts.
     */
    reminderDates: { type: [{ type: Date }], default: [] },
    /** Creator. Provenance only — never a query scope. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// The paginated list's default order. Without this the skip/limit sits behind
// a blocking in-memory sort.
vendorSchema.index({ name: 1 });
// The vendor reminder job starts from "which vendors are due today".
vendorSchema.index({ reminderDates: 1 });

export type VendorDoc = InferSchemaType<typeof vendorSchema> & { _id: Types.ObjectId };

// A hot reload keeps the previously compiled model, and strict mode then
// silently drops any field added to the schema since — saves "succeed" without
// them. Recompile when the cached model predates the reminder fields.
if (mongoose.models.Vendor && !mongoose.models.Vendor.schema.path("reminderDates")) {
  mongoose.deleteModel("Vendor");
}

export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ??
  mongoose.model("Vendor", vendorSchema);
