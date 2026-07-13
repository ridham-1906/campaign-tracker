/**
 * Seed the MongoDB database with a demo backend user and sample data.
 *
 *   npm run seed
 *
 * Login afterwards with:  demo@company.com  /  password123
 * (Update the seeded user's Gmail app password before real emails will send.)
 */
import "dotenv/config";
import mongoose, { Schema } from "mongoose";
import bcrypt from "bcryptjs";
import { encryptSecret } from "../src/lib/crypto";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Add it to .env");
  process.exit(1);
}

// Minimal schemas (kept in sync with src/models). Self-contained on purpose so
// the script doesn't pull in the app's server-only modules.
const userSchema = new Schema(
  { name: String, email: String, password: String, appPassword: String },
  { timestamps: true },
);
const salesSchema = new Schema(
  { name: String, email: String, userId: Schema.Types.ObjectId },
  { timestamps: true },
);
const nameSchema = new Schema(
  { name: String, userId: Schema.Types.ObjectId },
  { timestamps: true },
);
const campaignSchema = new Schema(
  {
    city: String,
    type: String,
    location: String,
    days: Number,
    status: String,
    startDate: Date,
    endDate: Date,
    userId: Schema.Types.ObjectId,
    salesId: Schema.Types.ObjectId,
    vendorId: Schema.Types.ObjectId,
    clientId: Schema.Types.ObjectId,
  },
  { timestamps: true },
);
const reminderSchema = new Schema(
  {
    campaignId: Schema.Types.ObjectId,
    date: Date,
    sent: Boolean,
    sentAt: Date,
  },
  { timestamps: true },
);

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + n);
  return x;
}
function diffDays(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

async function main() {
  await mongoose.connect(MONGODB_URI as string);
  const conn = mongoose.connection;

  const User = conn.model("User", userSchema);
  const Sales = conn.model("Sales", salesSchema);
  const Vendor = conn.model("Vendor", nameSchema);
  const Client = conn.model("Client", nameSchema);
  const Campaign = conn.model("Campaign", campaignSchema);
  const Reminder = conn.model("Reminder", reminderSchema);

  console.log("Clearing existing collections…");
  await Promise.all([
    User.deleteMany({}),
    Sales.deleteMany({}),
    Vendor.deleteMany({}),
    Client.deleteMany({}),
    Campaign.deleteMany({}),
    Reminder.deleteMany({}),
  ]);

  const user = await User.create({
    name: "Demo Backend",
    email: "demo@company.com",
    password: await bcrypt.hash("password123", 10),
    appPassword: encryptSecret("replace-with-gmail-app-password"),
  });
  const userId = user._id;

  const [ravi, neha, arjun] = await Sales.create([
    { name: "Ravi Kumar", email: "ravi@company.com", userId },
    { name: "Neha Sharma", email: "neha@company.com", userId },
    { name: "Arjun Mehta", email: "arjun@company.com", userId },
  ]);

  const [skyline, urban] = await Vendor.create([
    { name: "Skyline Media", userId },
    { name: "Urban Outdoor", userId },
  ]);

  const [acme, zenith, nova] = await Client.create([
    { name: "Acme Corp", userId },
    { name: "Zenith Retail", userId },
    { name: "Nova Foods", userId },
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Mix of lifecycles: expiring-today-reminder, expiring soon, active, expired.
  const specs = [
    { client: acme, sales: ravi, vendor: skyline, city: "Mumbai", type: "Billboard", location: "Andheri West", start: addDays(today, -23), end: addDays(today, 7) },
    { client: zenith, sales: neha, vendor: urban, city: "Delhi", type: "Hoarding", location: "Connaught Place", start: addDays(today, -10), end: addDays(today, 20) },
    { client: nova, sales: arjun, vendor: skyline, city: "Bengaluru", type: "Digital", location: "MG Road", start: addDays(today, -60), end: addDays(today, 45) },
    { client: acme, sales: neha, vendor: urban, city: "Pune", type: "Bus Shelter", location: "FC Road", start: addDays(today, -40), end: addDays(today, -3) },
  ];

  for (const s of specs) {
    const campaign = await Campaign.create({
      city: s.city,
      type: s.type,
      location: s.location,
      days: diffDays(s.start, s.end),
      status: "LIVE",
      startDate: s.start,
      endDate: s.end,
      userId,
      salesId: s.sales._id,
      vendorId: s.vendor._id,
      clientId: s.client._id,
    });

    // Default reminder = 7 days before end. For the first campaign that lands
    // on today, so the cron has something to send immediately.
    await Reminder.create({
      campaignId: campaign._id,
      date: addDays(s.end, -7),
      sent: false,
      sentAt: null,
    });
  }

  console.log("Seed complete.");
  console.log("  Login: demo@company.com / password123");
  console.log(`  Users: 1, Sales: 3, Vendors: 2, Clients: 3, Campaigns: ${specs.length}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
