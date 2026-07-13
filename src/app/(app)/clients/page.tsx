import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Campaign, Client } from "@/models";
import { NamedResourceManager } from "@/components/named-resource-manager";

export default async function ClientsPage() {
  const session = await requireSession();
  await connectDB();
  const [rows, campaigns] = await Promise.all([
    Client.find({ userId: session.userId }).sort({ name: 1 }).lean(),
    Campaign.find({ userId: session.userId }).select("clientId").lean(),
  ]);
  const count = (id: string) =>
    campaigns.filter((c) => String(c.clientId) === id).length;

  const items = rows.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    count: count(r._id.toString()),
  }));

  return (
    <NamedResourceManager
      resource="clients"
      singular="Client"
      description="Advertisers / brands the campaigns run for."
      items={items}
    />
  );
}
