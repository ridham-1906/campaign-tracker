import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- VendorReminder ----------------
/**
 * One row per vendor email sent: (vendor, campaign, business day).
 *
 * Vendor reminder dates live on the shared Vendor record, not on the campaign
 * locations, so there is no per-location field to stamp the way expiry and
 * creative reminders do. The unique index is the dedupe instead — the job
 * inserts the row *before* sending, so two overlapping runs can't both mail
 * the same vendor about the same campaign on the same day.
 */
export const vendorReminderSchema = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    /** The business day this reminder was for, as UTC midnight. */
    day: { type: Date, required: true },
    /** Campaign owner — the mailbox it was sent from. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sentTo: { type: [String], default: [] },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

vendorReminderSchema.index({ vendorId: 1, campaignId: 1, day: 1 }, { unique: true });
vendorReminderSchema.index({ day: 1 });

export type VendorReminderDoc = InferSchemaType<typeof vendorReminderSchema> & {
  _id: Types.ObjectId;
};

export const VendorReminder: Model<VendorReminderDoc> =
  (mongoose.models.VendorReminder as Model<VendorReminderDoc>) ??
  mongoose.model("VendorReminder", vendorReminderSchema);
