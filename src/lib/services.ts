import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Sales, Vendor } from "@/models";
import {
  type CampaignStatus,
  durationDays,
  reminderScheduleFor,
  startOfDay,
} from "@/lib/campaign";

/**
 * Shared write logic for campaigns, used by both the web UI and the JSON API so
 * the location/reminder rules live in exactly one place.
 */

/** One placement. `id` present = an existing subdoc; absent = a new one. */
export type LocationInput = {
  id?: string;
  city: string;
  location: string;
  type: string;
  vendorId: string;
  startDate: Date;
  endDate: Date;
  status?: CampaignStatus;
};

export type CampaignInput = {
  clientId: string;
  salesId: string;
  locations: LocationInput[];
};

export function isValidId(id: string) {
  return Types.ObjectId.isValid(id);
}

/** Shape a location input into the fields the subdocument schema expects. */
function buildLocation(input: LocationInput) {
  const start = startOfDay(input.startDate);
  const end = startOfDay(input.endDate);
  return {
    city: input.city,
    location: input.location,
    type: input.type,
    vendorId: input.vendorId,
    startDate: start,
    endDate: end,
    days: durationDays(start, end),
    status: input.status ?? "LIVE",
    ...reminderScheduleFor(end),
  };
}

/**
 * Verify every referenced record exists and belongs to the user. Vendors now
 * live on the locations, so all the distinct vendor ids are checked in one go.
 */
export async function validateRefsOwned(
  userId: string,
  refs: { salesId: string; clientId: string; vendorIds: string[] },
): Promise<string | null> {
  if (!isValidId(refs.salesId)) return "Invalid salesId";
  if (!isValidId(refs.clientId)) return "Invalid clientId";

  const vendorIds = [...new Set(refs.vendorIds)];
  if (vendorIds.some((id) => !isValidId(id))) return "Invalid vendorId";

  await connectDB();
  const [sales, client, vendors] = await Promise.all([
    Sales.countDocuments({ _id: refs.salesId, userId }),
    Client.countDocuments({ _id: refs.clientId, userId }),
    vendorIds.length
      ? Vendor.countDocuments({ _id: { $in: vendorIds }, userId })
      : 0,
  ]);
  if (!sales) return "salesId not found";
  if (!client) return "clientId not found";
  if (vendors !== vendorIds.length) return "vendorId not found";
  return null;
}

export async function createCampaignForUser(
  userId: string,
  input: CampaignInput,
) {
  await connectDB();
  // Campaign + every location + every reminder is now a single document, so
  // this is one atomic write rather than the old create-then-create pair.
  return Campaign.create({
    userId,
    clientId: input.clientId,
    salesId: input.salesId,
    locations: input.locations.map(buildLocation),
  });
}

/**
 * Reconcile the locations array against what's stored: update the ones the
 * client sent back by id, insert the ones with no id, drop the ones it omitted.
 */
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

  if (input.locations !== undefined) {
    const keptIds = new Set(
      input.locations.map((l) => l.id).filter(Boolean) as string[],
    );

    // Drop the locations the client no longer lists.
    campaign.locations = campaign.locations.filter((existing) =>
      keptIds.has(String(existing._id)),
    ) as typeof campaign.locations;

    for (const incoming of input.locations) {
      const next = buildLocation(incoming);

      if (!incoming.id) {
        campaign.locations.push(next as never);
        continue;
      }

      const existing = campaign.locations.find(
        (l) => String(l._id) === incoming.id,
      );
      if (!existing) continue; // id we don't own — ignore rather than resurrect

      // The reminder series is anchored to the end date, so it only restarts
      // when that moves; otherwise the location keeps its place in the series.
      const sameEnd =
        startOfDay(existing.endDate).getTime() === next.endDate.getTime();
      Object.assign(
        existing,
        next,
        sameEnd
          ? {
              reminderDate: existing.reminderDate,
              reminderSent: existing.reminderSent,
            }
          : { reminderSentAt: null },
      );
    }
  }

  await campaign.save();
  return campaign;
}

/** Load a campaign and one of its locations, scoped to the owning user. */
export async function findOwnedLocation(
  userId: string,
  campaignId: string,
  locationId: string,
) {
  if (!isValidId(campaignId) || !isValidId(locationId)) return null;
  await connectDB();

  const campaign = await Campaign.findOne({ _id: campaignId, userId });
  if (!campaign) return null;

  const location = campaign.locations.find(
    (l) => String(l._id) === locationId,
  );
  if (!location) return null;

  return { campaign, location };
}

export async function deleteCampaignForUser(userId: string, id: string) {
  if (!isValidId(id)) return false;
  await connectDB();
  // Locations (and their reminders) are embedded, so they go with the document.
  const campaign = await Campaign.findOneAndDelete({ _id: id, userId });
  return Boolean(campaign);
}

/**
 * Count campaigns referencing a person, to block deletes of in-use records.
 * A vendor counts once per campaign even if several of its locations use it —
 * so the "in use by N campaign(s)" message stays literally true.
 */
export async function countCampaignsUsing(
  userId: string,
  field: "salesId" | "vendorId" | "clientId",
  id: string,
) {
  await connectDB();
  const filter =
    field === "vendorId"
      ? { userId, "locations.vendorId": id }
      : { userId, [field]: id };
  return Campaign.countDocuments(filter);
}
