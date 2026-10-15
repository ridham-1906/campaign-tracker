import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- User ----------------
export const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true }, // bcrypt hash
    // Gmail app password (nodemailer). Optional — without one the user sends no mail.
    appPassword: { type: String, default: "" },
    // Cross-user read visibility (Dashboard, Campaigns/Images "see everyone").
    // Checked live from this document on every request (see getSession() in
    // lib/auth.ts) rather than cached in the session cookie, so flipping it
    // takes effect on the user's very next request — no server restart, no
    // re-login needed.
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

// A hot reload keeps the previously compiled model, and strict mode then
// silently drops any field added to the schema since — saves "succeed"
// without them (see the identical note in models/vendor.ts). Recompile when
// the cached model predates `isAdmin`.
if (mongoose.models.User && !mongoose.models.User.schema.path("isAdmin")) {
  mongoose.deleteModel("User");
}

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model("User", userSchema);
