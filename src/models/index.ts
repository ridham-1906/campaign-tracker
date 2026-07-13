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

// ---------------- Campaign ----------------
const campaignSchema = new Schema(
  {
    city: { type: String, required: true },
    type: { type: String, required: true },
    location: { type: String, required: true },
    days: { type: Number, required: true },
    status: {
      type: String,
      enum: ["LIVE", "ENDED"],
      default: "LIVE",
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true, index: true },

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    salesId: { type: Schema.Types.ObjectId, ref: "Sales", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
  },
  { timestamps: true },
);

// ---------------- Reminder ----------------
const reminderSchema = new Schema(
  {
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    date: { type: Date, required: true, index: true }, // day the reminder fires
    sent: { type: Boolean, default: false },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export type SalesDoc = InferSchemaType<typeof salesSchema> & { _id: Types.ObjectId };
export type VendorDoc = InferSchemaType<typeof vendorSchema> & { _id: Types.ObjectId };
export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };
export type CampaignDoc = InferSchemaType<typeof campaignSchema> & {
  _id: Types.ObjectId;
};
export type ReminderDoc = InferSchemaType<typeof reminderSchema> & {
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
export const Reminder: Model<ReminderDoc> =
  (mongoose.models.Reminder as Model<ReminderDoc>) ??
  mongoose.model("Reminder", reminderSchema);
