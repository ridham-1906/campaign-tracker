import "server-only";
import { Schema, Types, InferSchemaType } from "mongoose";

/**
 * One finished booking period, archived when the campaign is renewed.
 *
 * A renewal used to write a whole second campaign, which left the client, the
 * sales person and every location duplicated across rows that had no link back
 * to each other. Renewing now updates the campaign in place: the dates it was
 * running on move into here, the term counter goes up, and the locations take
 * the new dates. One campaign, one row, however many times it is rebooked.
 *
 * Only the dates are snapshotted. City, medium, vendor and the rest are not
 * versioned — they describe the *site*, which doesn't change when the booking
 * rolls over, and the live values stay on the location subdocument.
 */
export const campaignTermSchema = new Schema(
  {
    /** 1-based, matching the `term` the campaign was on while this ran. */
    term: { type: Number, required: true },
    /** When the renewal that closed this term was made. */
    renewedAt: { type: Date, default: Date.now },
    locations: [
      {
        _id: false,
        // Points at the live location subdocument, which survives edits — see
        // the foreign-key note in models/attachment.ts. A location added in a
        // later term simply has no entry in the earlier terms.
        locationId: { type: Schema.Types.ObjectId, required: true },
        startDate: { type: Date, required: true },
        midDate: { type: Date, default: null },
        endDate: { type: Date, required: true },
        days: { type: Number, required: true },
      },
    ],
  },
  { _id: false },
);

export type CampaignTerm = InferSchemaType<typeof campaignTermSchema> & {
  locations: { locationId: Types.ObjectId }[];
};
