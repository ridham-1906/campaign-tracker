import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- CampaignShare ----------------
/**
 * A public, unguessable link to one campaign's uploads, handed to the sales
 * person by email so they can browse, download and export the deck without an
 * account.
 *
 * Deliberately has no expiry field and no TTL index: the link is meant to keep
 * working forever, so a sales person can reopen a months-old mail and still
 * reach the photos. Revoking one means deleting the document.
 *
 * `campaignId` is unique, so a campaign has exactly one link no matter how
 * many times it's sent — resending mails the same URL rather than orphaning
 * the one already sitting in someone's inbox.
 */
export const campaignShareSchema = new Schema(
  {
    // 32 url-safe chars from crypto.randomBytes — this is the only credential
    // guarding the campaign's files, so it must never be a guessable id.
    token: { type: String, required: true, unique: true },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      unique: true,
    },
    /** The owner who shared it — kept so the link survives independently of
     * whichever sales person it was last mailed to. */
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    lastSentTo: { type: String, default: null },
    lastSentAt: { type: Date, default: null },
    sendCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type CampaignShareDoc = InferSchemaType<typeof campaignShareSchema> & {
  _id: Types.ObjectId;
};

export const CampaignShare: Model<CampaignShareDoc> =
  (mongoose.models.CampaignShare as Model<CampaignShareDoc>) ??
  mongoose.model("CampaignShare", campaignShareSchema);
