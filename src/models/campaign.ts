import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";
import { campaignLocationSchema } from "@/models/campaign-location";
import { campaignTermSchema } from "@/models/campaign-term";

// ---------------- Campaign ----------------
export const campaignSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    salesId: { type: Schema.Types.ObjectId, ref: "Sales", required: true },
    // Campaign-wide, not per-location — one value covers every placement.
    category: { type: String, default: "" },

    // Which booking period the campaign is on. 1 until it is first renewed;
    // every renewal archives the outgoing dates into `termHistory` and bumps
    // this. Attachments carry the term they were uploaded under, so each
    // renewal's photos stay separate without duplicating the campaign.
    term: { type: Number, default: 1 },
    termHistory: { type: [campaignTermSchema], default: [] },

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
// Backs the same scan's pending-creative arm. No userId prefix on purpose —
// the cron matches across users, so it stays alongside the per-user index below.
campaignSchema.index({ "locations.status": 1, "locations.endDate": 1 });
// Backs the "is this vendor still in use?" check before a vendor delete.
campaignSchema.index({ userId: 1, "locations.vendorId": 1 });

// ---- Backing the paginated list and its status tiles ----
// All of these draw both keys from the same `locations` array, which is legal
// multikey. Do not add one mixing `locations.*` with a second parallel array.
campaignSchema.index({ userId: 1, "locations.endDate": 1 });
campaignSchema.index({ userId: 1, "locations.status": 1, "locations.endDate": 1 });
// The "reminders sent today" tile.
campaignSchema.index({ userId: 1, "locations.reminderSentAt": 1 });
// The per-page "in use by N campaigns" counts on the clients/sales screens.
campaignSchema.index({ userId: 1, clientId: 1 });
campaignSchema.index({ userId: 1, salesId: 1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema> & {
  _id: Types.ObjectId;
};

export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ??
  mongoose.model("Campaign", campaignSchema);
