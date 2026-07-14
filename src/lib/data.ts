import "server-only";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Sales, Vendor } from "@/models";

// Plain, client-safe shapes returned to React Server Components.

export type PersonView = { id: string; name: string; email?: string };

export type LocationView = {
  id: string;
  city: string;
  location: string;
  type: string;
  days: number;
  status: string;
  vendor: PersonView;
  startDate: string; // ISO
  endDate: string; // ISO
  reminder: { date: string; sent: boolean; sentAt: string | null };
};

export type CampaignView = {
  id: string;
  client: PersonView;
  sales: PersonView;
  locations: LocationView[];
};

export async function getSalesList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Sales.find({ userId }).sort({ name: 1 }).lean();
  return rows.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    email: r.email,
  }));
}

export async function getVendorList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Vendor.find({ userId }).sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

export async function getClientList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Client.find({ userId }).sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

type LeanRef = { _id: unknown; name?: string; email?: string } | null | undefined;

function personFrom(ref: LeanRef): PersonView {
  if (!ref || typeof ref !== "object" || !("_id" in ref)) {
    return { id: "", name: "—" };
  }
  return {
    id: String(ref._id),
    name: ref.name ?? "—",
    email: ref.email,
  };
}

type LeanLocation = {
  _id: unknown;
  city: string;
  location: string;
  type: string;
  days: number;
  status: string;
  vendorId: unknown;
  startDate: Date;
  endDate: Date;
  reminderDate: Date;
  reminderSent: boolean;
  reminderSentAt?: Date | null;
};

function locationFrom(l: LeanLocation): LocationView {
  return {
    id: String(l._id),
    city: l.city,
    location: l.location,
    type: l.type,
    days: l.days,
    status: l.status,
    vendor: personFrom(l.vendorId as LeanRef),
    startDate: new Date(l.startDate).toISOString(),
    endDate: new Date(l.endDate).toISOString(),
    reminder: {
      date: new Date(l.reminderDate).toISOString(),
      sent: l.reminderSent,
      sentAt: l.reminderSentAt
        ? new Date(l.reminderSentAt).toISOString()
        : null,
    },
  };
}

/** Soonest end date across a campaign's locations — the list's sort key. */
function earliestEnd(locations: LeanLocation[]) {
  return locations.reduce(
    (min, l) => Math.min(min, new Date(l.endDate).getTime()),
    Infinity,
  );
}

export async function getCampaigns(userId: string): Promise<CampaignView[]> {
  await connectDB();
  const rows = await Campaign.find({ userId })
    .populate("salesId", "name email")
    .populate("clientId", "name")
    .populate("locations.vendorId", "name")
    .lean();

  // There's no single campaign-level end date to sort on anymore, so order by
  // whichever of a campaign's locations ends soonest.
  rows.sort(
    (a, b) =>
      earliestEnd(a.locations as unknown as LeanLocation[]) -
      earliestEnd(b.locations as unknown as LeanLocation[]),
  );

  return rows.map((r) => ({
    id: r._id.toString(),
    client: personFrom(r.clientId as LeanRef),
    sales: personFrom(r.salesId as LeanRef),
    locations: (r.locations as unknown as LeanLocation[]).map(locationFrom),
  }));
}

export async function getCampaign(
  userId: string,
  id: string,
): Promise<CampaignView | null> {
  await connectDB();
  const r = await Campaign.findOne({ _id: id, userId })
    .populate("salesId", "name email")
    .populate("clientId", "name")
    .populate("locations.vendorId", "name")
    .lean();
  if (!r) return null;

  return {
    id: r._id.toString(),
    client: personFrom(r.clientId as LeanRef),
    sales: personFrom(r.salesId as LeanRef),
    locations: (r.locations as unknown as LeanLocation[]).map(locationFrom),
  };
}
