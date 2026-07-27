import "server-only";
import { Schema, Types, InferSchemaType } from "mongoose";

export const campaignLocationSchema = new Schema({
  city: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true },
  vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true },
  status: { type: String, enum: ["LIVE", "ENDED", "PENDING_CREATIVE"], default: "LIVE" },

  // Next expiry reminder due, rolled forward after each send.
  reminderDate: { type: Date, required: true },
  // True once the whole 7/5/3/2/1 series is exhausted.
  reminderSent: { type: Boolean, default: false },
  reminderSentAt: { type: Date, default: null },
  // Pending-creative nag is daily, so only the last send date is tracked.
  creativeReminderSentAt: { type: Date, default: null },

  // Attachments live in their own collection keyed by (campaignId, locationId)
  // — see models/attachment.ts. They are deliberately not embedded here: that
  // made the images screen unwind every campaign to page over files, put
  // metadata the campaign table never renders into its payload, and turned each
  // single-file upload into a rewrite of the whole campaign document.
});

export type CampaignLocationDoc = InferSchemaType<
  typeof campaignLocationSchema
> & { _id: Types.ObjectId };
