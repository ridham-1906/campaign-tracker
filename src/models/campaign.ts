import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";
import { campaignLocationSchema } from "@/models/campaign-location";

// ---------------- Campaign ----------------
export const campaignSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    salesId: { type: Schema.Types.ObjectId, ref: "Sales", required: true },

    locations: {
      type: [campaignLocationSchema],
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
        message: "A campaign needs at least one location",
      },
    },
  },
  { timestamps: true },
);

// Backs the cron's $elemMatch scan for past-due expiry reminders.
campaignSchema.index({ "locations.reminderDate": 1, "locations.endDate": 1 });
// Backs the same scan's pending-creative arm.
campaignSchema.index({ "locations.status": 1, "locations.endDate": 1 });
// Backs the "is this vendor still in use?" check before a vendor delete.
campaignSchema.index({ userId: 1, "locations.vendorId": 1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema> & {
  _id: Types.ObjectId;
};

export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ??
  mongoose.model("Campaign", campaignSchema);
