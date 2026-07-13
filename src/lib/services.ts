import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Reminder, Sales, Vendor } from "@/models";
import {
  type CampaignStatus,
  defaultReminderDate,
  durationDays,
  startOfDay,
} from "@/lib/campaign";

/**
 * Shared write logic for campaigns, used by both the web UI server actions and
 * the JSON API so the reminder-handling rules live in exactly one place.
 */

export type CampaignInput = {
  clientId: string;
  salesId: string;
  vendorId: string;
  city: string;
  type: string;
  location: string;
  startDate: Date;
  endDate: Date;
  status?: CampaignStatus;
  reminderDate?: Date;
};

export function isValidId(id: string) {
  return Types.ObjectId.isValid(id);
}

/** Verify each referenced person exists and belongs to the user. */
export async function validateRefsOwned(
  userId: string,
  refs: { salesId: string; vendorId: string; clientId: string },
): Promise<string | null> {
  if (!isValidId(refs.salesId)) return "Invalid salesId";
  if (!isValidId(refs.vendorId)) return "Invalid vendorId";
  if (!isValidId(refs.clientId)) return "Invalid clientId";

  await connectDB();
  const [sales, vendor, client] = await Promise.all([
    Sales.countDocuments({ _id: refs.salesId, userId }),
    Vendor.countDocuments({ _id: refs.vendorId, userId }),
    Client.countDocuments({ _id: refs.clientId, userId }),
  ]);
  if (!sales) return "salesId not found";
  if (!vendor) return "vendorId not found";
  if (!client) return "clientId not found";
  return null;
}

export async function createCampaignForUser(
  userId: string,
  input: CampaignInput,
) {
  await connectDB();
  const start = startOfDay(input.startDate);
  const end = startOfDay(input.endDate);

  const campaign = await Campaign.create({
    userId,
    clientId: input.clientId,
    salesId: input.salesId,
    vendorId: input.vendorId,
    city: input.city,
    type: input.type,
    location: input.location,
    days: durationDays(start, end),
    status: input.status ?? "LIVE",
    startDate: start,
    endDate: end,
  });

  const reminderDate = input.reminderDate
    ? startOfDay(input.reminderDate)
    : defaultReminderDate(end);

  await Reminder.create({ campaignId: campaign._id, date: reminderDate });
  return campaign;
}

export async function updateCampaignForUser(
  userId: string,
  id: string,
  input: Partial<CampaignInput>,
) {
  if (!isValidId(id)) return null;
  await connectDB();

  const campaign = await Campaign.findOne({ _id: id, userId });
  if (!campaign) return null;

  if (input.clientId !== undefined) campaign.clientId = input.clientId as never;
  if (input.salesId !== undefined) campaign.salesId = input.salesId as never;
  if (input.vendorId !== undefined) campaign.vendorId = input.vendorId as never;
  if (input.city !== undefined) campaign.city = input.city;
  if (input.type !== undefined) campaign.type = input.type;
  if (input.location !== undefined) campaign.location = input.location;
  if (input.status !== undefined) campaign.status = input.status;
  if (input.startDate !== undefined)
    campaign.startDate = startOfDay(input.startDate);
  if (input.endDate !== undefined) campaign.endDate = startOfDay(input.endDate);
  campaign.days = durationDays(
    new Date(campaign.startDate),
    new Date(campaign.endDate),
  );
  await campaign.save();

  // Update the reminder when a new reminder date (or a new end date) is given.
  const newReminderDate = input.reminderDate
    ? startOfDay(input.reminderDate)
    : input.endDate !== undefined
      ? defaultReminderDate(startOfDay(input.endDate))
      : null;

  if (newReminderDate) {
    const existing = await Reminder.findOne({ campaignId: campaign._id });
    if (existing) {
      existing.date = newReminderDate;
      if (newReminderDate >= startOfDay(new Date())) {
        existing.sent = false;
        existing.sentAt = null;
      }
      await existing.save();
    } else {
      await Reminder.create({ campaignId: campaign._id, date: newReminderDate });
    }
  }

  return campaign;
}

export async function deleteCampaignForUser(userId: string, id: string) {
  if (!isValidId(id)) return false;
  await connectDB();
  const campaign = await Campaign.findOneAndDelete({ _id: id, userId });
  if (!campaign) return false;
  await Reminder.deleteMany({ campaignId: campaign._id });
  return true;
}

/** Count campaigns referencing a person, to block deletes of in-use records. */
export async function countCampaignsUsing(
  userId: string,
  field: "salesId" | "vendorId" | "clientId",
  id: string,
) {
  await connectDB();
  return Campaign.countDocuments({ userId, [field]: id });
}
