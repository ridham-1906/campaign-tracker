import "server-only";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, Client, ImageType, Sales, Vendor } from "@/models";
import { getBucketId, getStorage } from "@/lib/appwrite";
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
  /** Media format — Billboard, Gantry, LED… */
  medium: string;
  vendorId: string;
  /** Illumination — "Lit" / "Nonlit". */
  type?: string;
  width?: number;
  height?: number;
  sqft?: number;
  startDate: Date;
  midDate?: Date;
  endDate: Date;
  status?: CampaignStatus;
};

export type CampaignInput = {
  clientId: string;
  salesId: string;
  category?: string;
  locations: LocationInput[];
};

export function isValidId(id: string) {
  return Types.ObjectId.isValid(id);
}

/**
 * Delete attachments and their Appwrite blobs — a whole campaign's worth,
 * specific locations within it, or an explicit set of attachments.
 *
 * When attachments were embedded, the cascades were free: the subdocuments went
 * with their parent. Now they must be explicit, and three callers need it —
 * deleting a campaign, *editing* a campaign to drop a location, and the user
 * deleting files from the preview dialog. The middle one doesn't look like a
 * delete, which is exactly why this lives in one function rather than being
 * inlined at each site. Missing any of them leaks Appwrite storage silently:
 * no error, just cost.
 *
 * Mongo is the source of truth for the UI, so the rows go first and the blobs
 * are best-effort — an orphaned blob nobody can see beats an attachment the
 * user can never remove.
 *
 * Returns the ids actually removed, so an API caller can tell the client
 * precisely what to drop rather than making it re-fetch.
 */
export async function deleteAttachmentsFor(scope: {
  campaignId: Types.ObjectId | string;
  /** Scope to specific locations. Omit for every location on the campaign. */
  locationIds?: (Types.ObjectId | string)[];
  /** Scope to specific attachments. Omit for all within the above scope. */
  attachmentIds?: (Types.ObjectId | string)[];
  /** Belt-and-braces ownership check when the ids came from a request. */
  userId?: string;
}): Promise<string[]> {
  await connectDB();

  // An empty explicit set means "nothing", not "everything" — without this the
  // filter would widen to the whole scope and delete far more than asked.
  if (scope.locationIds?.length === 0) return [];
  if (scope.attachmentIds?.length === 0) return [];

  const filter = {
    campaignId: scope.campaignId,
    ...(scope.userId ? { userId: scope.userId } : {}),
    ...(scope.locationIds ? { locationId: { $in: scope.locationIds } } : {}),
    ...(scope.attachmentIds ? { _id: { $in: scope.attachmentIds } } : {}),
  };

  const doomed = await Attachment.find(filter).select("fileId").lean();
  if (doomed.length === 0) return [];

  await Attachment.deleteMany(filter);

  const storage = getStorage();
  const bucketId = getBucketId();
  await Promise.all(
    doomed.map((a) =>
      storage.deleteFile({ bucketId, fileId: a.fileId }).catch((err) => {
        console.error(`Appwrite delete failed for file ${a.fileId}:`, err);
      }),
    ),
  );

  return doomed.map((a) => String(a._id));
}

/** Shape a location input into the fields the subdocument schema expects. */
function buildLocation(input: LocationInput) {
  const start = startOfDay(input.startDate);
  const end = startOfDay(input.endDate);
  const mid = input.midDate ? startOfDay(input.midDate) : null;
  return {
    city: input.city,
    location: input.location,
    medium: input.medium,
    vendorId: input.vendorId,
    type: input.type ?? "",
    width: input.width ?? null,
    height: input.height ?? null,
    sqft: input.sqft ?? null,
    startDate: start,
    midDate: mid,
    endDate: end,
    days: durationDays(start, end),
    status: input.status ?? "LIVE",
    ...reminderScheduleFor(end),
  };
}

/**
 * Verify every referenced record exists. Vendors now live on the locations, so
 * all the distinct vendor ids are checked in one go.
 *
 * There is no ownership half to this check any more: clients, vendors and
 * sales people are a shared directory (see models/client.ts), so any of them
 * is a legitimate reference for any user's campaign. Existence still is
 * checked — a campaign must never point at an id that isn't there.
 */
export async function validateRefs(refs: {
  salesId: string;
  clientId: string;
  vendorIds: string[];
}): Promise<string | null> {
  if (!isValidId(refs.salesId)) return "Invalid salesId";
  if (!isValidId(refs.clientId)) return "Invalid clientId";

  const vendorIds = [...new Set(refs.vendorIds)];
  if (vendorIds.some((id) => !isValidId(id))) return "Invalid vendorId";

  await connectDB();
  const [sales, client, vendors] = await Promise.all([
    Sales.countDocuments({ _id: refs.salesId }),
    Client.countDocuments({ _id: refs.clientId }),
    vendorIds.length
      ? Vendor.countDocuments({ _id: { $in: vendorIds } })
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
    category: input.category ?? "",
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
  if (input.category !== undefined) campaign.category = input.category;

  if (input.locations !== undefined) {
    const keptIds = new Set(
      input.locations.map((l) => l.id).filter(Boolean) as string[],
    );

    // Drop the locations the client no longer lists. Their attachments used to
    // go with them for free while embedded; now this edit is a delete for the
    // Attachment collection too, and skipping it would orphan the rows and
    // leak their Appwrite blobs.
    const droppedIds = campaign.locations
      .filter((existing) => !keptIds.has(String(existing._id)))
      .map((existing) => existing._id);
    if (droppedIds.length > 0) {
      await deleteAttachmentsFor({ campaignId: campaign._id, locationIds: droppedIds });
    }

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

/**
 * Roll a campaign into its next booking period, in place.
 *
 * This used to be a plain `create` from a prefilled form, which left a second
 * campaign row duplicating the client, sales person and every location, with
 * nothing tying the two together. Now the campaign is the durable thing and the
 * *term* is what repeats: the dates it has been running on are archived into
 * `termHistory`, `term` goes up by one, and the locations take the new dates.
 *
 * Photos are not touched. Each attachment already carries the term it was
 * uploaded under, so last period's installation shots stay attached to the
 * campaign and stay distinguishable from this period's — which is the whole
 * reason renewing no longer clones anything.
 *
 * Locations may be added but never removed here: a location that disappeared
 * would orphan the attachments and history entries pointing at its subdocument
 * id. Dropping a site is a normal edit, which cascades those deletes properly.
 */
export async function renewCampaignForUser(
  userId: string,
  id: string,
  input: { locations: LocationInput[] },
) {
  if (!isValidId(id)) return null;
  await connectDB();

  const campaign = await Campaign.findOne({ _id: id, userId });
  if (!campaign) return null;

  const term = campaign.term ?? 1;

  // Snapshot what the outgoing term ran on before the dates are overwritten.
  campaign.termHistory.push({
    term,
    renewedAt: new Date(),
    locations: campaign.locations.map((l) => ({
      locationId: l._id,
      startDate: l.startDate,
      midDate: l.midDate ?? null,
      endDate: l.endDate,
      days: l.days,
    })),
  } as never);
  campaign.term = term + 1;

  // Ids that are part of the new term — collected as we go so a location added
  // during the renewal (which only gets its _id on push) counts as renewed.
  const renewedIds = new Set<string>();

  for (const incoming of input.locations) {
    // A brand-new site joining from this term on.
    if (!incoming.id) {
      const added = campaign.locations[
        campaign.locations.push(buildLocation(incoming) as never) - 1
      ];
      renewedIds.add(String(added._id));
      continue;
    }

    const existing = campaign.locations.find(
      (l) => String(l._id) === incoming.id,
    );
    if (!existing) continue; // id we don't own — ignore rather than resurrect

    // A renewal is a fresh booking, so the reminder series restarts outright:
    // no `sameEnd` carry-over the way an edit has, and nothing about the last
    // term's sends should suppress this term's.
    Object.assign(existing, buildLocation(incoming), {
      reminderSent: false,
      reminderSentAt: null,
      creativeReminderSentAt: null,
    });
    renewedIds.add(String(existing._id));
  }

  // A site the form didn't send wasn't rebooked. It keeps its previous dates
  // and its photos — deleting it is a normal edit, not a renewal — but it drops
  // out of the live set so it stops drawing reminders.
  for (const existing of campaign.locations) {
    if (!renewedIds.has(String(existing._id))) {
      existing.status = "ENDED";
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
  // Attachments no longer are, so they need an explicit cascade.
  const campaign = await Campaign.findOneAndDelete({ _id: id, userId });
  if (!campaign) return false;
  await deleteAttachmentsFor({ campaignId: campaign._id });
  return true;
}

/**
 * Count campaigns referencing a person, to block deletes of in-use records.
 * A vendor counts once per campaign even if several of its locations use it —
 * so the "in use by N campaign(s)" message stays literally true.
 *
 * Counted across every user, not just the one asking. The directory is shared
 * but campaigns are not, so scoping this to the caller would let one user
 * delete a client that another user's campaigns still point at, leaving those
 * campaigns with a dangling reference and a blank name in the list.
 */
export async function countCampaignsUsing(
  field: "salesId" | "vendorId" | "clientId",
  id: string,
) {
  await connectDB();
  const filter =
    field === "vendorId" ? { "locations.vendorId": id } : { [field]: id };
  return Campaign.countDocuments(filter);
}

/**
 * The "+ Add custom type" flow in the type-of-image picker: reuse an existing
 * type of the same name (case-insensitively) rather than creating a
 * duplicate, so retyping an already-seeded name like "installation" just
 * selects it instead of splitting it into two entries.
 */
export async function getOrCreateImageType(userId: string, name: string) {
  await connectDB();
  const trimmed = name.trim();
  const existing = await ImageType.find({ userId });
  const match = existing.find(
    (t) => t.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return match;
  return ImageType.create({ userId, name: trimmed, role: null });
}
