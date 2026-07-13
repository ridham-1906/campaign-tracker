import "server-only";
import { connectDB } from "@/lib/db";
import { Campaign, Client, Reminder, Sales, Vendor } from "@/models";

// Plain, client-safe shapes returned to React Server Components.

export type PersonView = { id: string; name: string; email?: string };

export type CampaignView = {
  id: string;
  city: string;
  type: string;
  location: string;
  days: number;
  status: string;
  startDate: string; // ISO
  endDate: string; // ISO
  sales: PersonView;
  vendor: PersonView;
  client: PersonView;
  reminder: { id: string; date: string; sent: boolean; sentAt: string | null } | null;
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

export async function getCampaigns(userId: string): Promise<CampaignView[]> {
  await connectDB();
  const rows = await Campaign.find({ userId })
    .sort({ endDate: 1 })
    .populate("salesId", "name email")
    .populate("vendorId", "name")
    .populate("clientId", "name")
    .lean();

  const ids = rows.map((r) => r._id);
  const reminders = await Reminder.find({ campaignId: { $in: ids } }).lean();
  const reminderByCampaign = new Map(
    reminders.map((r) => [r.campaignId.toString(), r]),
  );

  return rows.map((r) => {
    const rem = reminderByCampaign.get(r._id.toString());
    return {
      id: r._id.toString(),
      city: r.city,
      type: r.type,
      location: r.location,
      days: r.days,
      status: r.status,
      startDate: new Date(r.startDate).toISOString(),
      endDate: new Date(r.endDate).toISOString(),
      sales: personFrom(r.salesId as LeanRef),
      vendor: personFrom(r.vendorId as LeanRef),
      client: personFrom(r.clientId as LeanRef),
      reminder: rem
        ? {
            id: rem._id.toString(),
            date: new Date(rem.date).toISOString(),
            sent: rem.sent,
            sentAt: rem.sentAt ? new Date(rem.sentAt).toISOString() : null,
          }
        : null,
    };
  });
}

export async function getCampaign(
  userId: string,
  id: string,
): Promise<CampaignView | null> {
  await connectDB();
  const r = await Campaign.findOne({ _id: id, userId })
    .populate("salesId", "name email")
    .populate("vendorId", "name")
    .populate("clientId", "name")
    .lean();
  if (!r) return null;

  const rem = await Reminder.findOne({ campaignId: r._id }).lean();

  return {
    id: r._id.toString(),
    city: r.city,
    type: r.type,
    location: r.location,
    days: r.days,
    status: r.status,
    startDate: new Date(r.startDate).toISOString(),
    endDate: new Date(r.endDate).toISOString(),
    sales: personFrom(r.salesId as LeanRef),
    vendor: personFrom(r.vendorId as LeanRef),
    client: personFrom(r.clientId as LeanRef),
    reminder: rem
      ? {
          id: rem._id.toString(),
          date: new Date(rem.date).toISOString(),
          sent: rem.sent,
          sentAt: rem.sentAt ? new Date(rem.sentAt).toISOString() : null,
        }
      : null,
  };
}
