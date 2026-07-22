import "server-only";
import mongoose, { Schema, Model, Types, InferSchemaType } from "mongoose";

// ---------------- User ----------------
export const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true }, // bcrypt hash
    appPassword: { type: String, required: true }, // Gmail app password (nodemailer)
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

export const User: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc>) ?? mongoose.model("User", userSchema);
