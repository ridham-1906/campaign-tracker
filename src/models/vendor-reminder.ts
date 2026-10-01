import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- VendorReminder ----------------

/** The four kinds of vendor email — see lib/reminders/vendor.ts. */
export const VENDOR_REMINDER_KINDS = [
  "sites",
  "installation",
  "mid_date",
  "end_date",
] as const;
export type VendorReminderKind = (typeof VENDOR_REMINDER_KINDS)[number];

/**
 * One row per vendor email sent: (vendor, campaign, business day, kind).
 *
 * Vendor reminder dates live on the shared Vendor record, not on the campaign
 * locations, so there is no per-location field to stamp the way expiry and
 * creative reminders do. The unique index is the dedupe instead — the job
 * inserts the row *before* sending, so two overlapping runs can't both mail
 * the same vendor about the same campaign, for the same kind, on the same day.
 *
 * `kind` distinguishes the plain "your live sites" email from the three
 * stage-photo asks, which are driven by their own vendor date lists
 * (installReminderDates/midReminderDates/endReminderDates) and would
 * otherwise collide with a same-day "sites" send for the same campaign.
 */
export const vendorReminderSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    /** The business day this reminder was for, as UTC midnight. */
    day: { type: Date, required: true },
    /** Defaults to "sites" so pre-existing rows, written before this field
     * existed, keep meaning what they always meant. */
    kind: { type: String, enum: VENDOR_REMINDER_KINDS, default: "sites" },
    /** Campaign owner — the mailbox it was sent from. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentTo: { type: [String], default: [] },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

vendorReminderSchema.index(
  { vendorId: 1, campaignId: 1, day: 1, kind: 1 },
  { unique: true },
);
vendorReminderSchema.index({ day: 1 });

export type VendorReminderDoc = InferSchemaType<typeof vendorReminderSchema> & {
  _id: Types.ObjectId;
};

// A hot reload keeps the previously compiled model, and strict mode then
// silently drops any field added to the schema since — see the same note in
// models/vendor.ts. Recompile when the cached model predates `kind`, and drop
// its old (vendorId, campaignId, day) unique index first — Mongoose doesn't
// reconcile index changes on an existing collection by itself.
if (mongoose.models.VendorReminder && !mongoose.models.VendorReminder.schema.path("kind")) {
  mongoose.deleteModel("VendorReminder");
}

export const VendorReminder: Model<VendorReminderDoc> =
  (mongoose.models.VendorReminder as Model<VendorReminderDoc>) ??
  mongoose.model("VendorReminder", vendorReminderSchema);
