import "server-only";
import { Schema, Types, InferSchemaType } from "mongoose";
import { attachmentSchema } from "@/models/attachment";

// ---------------- Campaign location ----------------
/**
 * One placement within a campaign: a site, its vendor, its own dates, its own
 * lifecycle and its own reminder. A campaign runs at several of these at once,
 * and they can end (and be reminded about) independently.
 *
 * The reminder lives here rather than in its own collection so the cron query
 * returns whole campaigns with their due locations already grouped — which is
 * exactly what the one-email-per-campaign digest needs.
 */
export const campaignLocationSchema = new Schema({
  city: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true },
  vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true },
  status: { type: String, enum: ["LIVE", "ENDED", "PENDING_CREATIVE"], default: "LIVE" },

  reminderDate: { type: Date, required: true },
  reminderSent: { type: Boolean, default: false },
  reminderSentAt: { type: Date, default: null },

  attachments: { type: [attachmentSchema], default: [] },
});

export type CampaignLocationDoc = InferSchemaType<
  typeof campaignLocationSchema
> & { _id: Types.ObjectId };
