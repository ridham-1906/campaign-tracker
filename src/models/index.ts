import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

/**
 * Models are defined with the `models.X ?? model(...)` guard so they survive
 * Next.js hot reloads without "OverwriteModelError".
 */

// ---------------- User ----------------
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true }, // bcrypt hash
    appPassword: { type: String, required: true }, // Gmail app password (nodemailer)
  },
  { timestamps: true },
);

// ---------------- Sales ----------------
const salesSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// ---------------- Vendor ----------------
const vendorSchema = new Schema(
  {
    name: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

// ---------------- Client ----------------
const clientSchema = new Schema(
  {
    name: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true },
);

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
const campaignLocationSchema = new Schema({
  city: { type: String, required: true },
  location: { type: String, required: true },
  type: { type: String, required: true },
  vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },

  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true },
  status: { type: String, enum: ["LIVE", "ENDED"], default: "LIVE" },

  reminderDate: { type: Date, required: true },
  reminderSent: { type: Boolean, default: false },
  reminderSentAt: { type: Date, default: null },
});

// ---------------- Campaign ----------------
const campaignSchema = new Schema(
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

// Backs the cron's $elemMatch scan for unsent, past-due reminders.
campaignSchema.index({ "locations.reminderSent": 1, "locations.reminderDate": 1 });
// Backs the "is this vendor still in use?" check before a vendor delete.
campaignSchema.index({ userId: 1, "locations.vendorId": 1 });

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type SalesDoc = InferSchemaType<typeof salesSchema> & { _id: Types.ObjectId };
export type VendorDoc = InferSchemaType<typeof vendorSchema> & { _id: Types.ObjectId };
export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };
export type CampaignLocationDoc = InferSchemaType<
  typeof campaignLocationSchema
> & { _id: Types.ObjectId };
export type CampaignDoc = InferSchemaType<typeof campaignSchema> & {
  _id: Types.ObjectId;
};

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model("User", userSchema);
export const Sales: Model<SalesDoc> =
  (mongoose.models.Sales as Model<SalesDoc>) ??
  mongoose.model("Sales", salesSchema);
export const Vendor: Model<VendorDoc> =
  (mongoose.models.Vendor as Model<VendorDoc>) ??
  mongoose.model("Vendor", vendorSchema);
export const Client: Model<ClientDoc> =
  (mongoose.models.Client as Model<ClientDoc>) ??
  mongoose.model("Client", clientSchema);
export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ??
  mongoose.model("Campaign", campaignSchema);
