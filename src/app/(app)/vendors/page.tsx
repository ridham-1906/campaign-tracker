import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Campaign, Vendor } from "@/models";
import { NamedResourceManager } from "@/components/named-resource-manager";

export default async function VendorsPage() {
  const session = await requireSession();
  await connectDB();
  const [rows, campaigns] = await Promise.all([
    Vendor.find({ userId: session.userId }).sort({ name: 1 }).lean(),
    Campaign.find({ userId: session.userId }).select("vendorId").lean(),
  ]);
  const count = (id: string) =>
    campaigns.filter((c) => String(c.vendorId) === id).length;

  const items = rows.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    count: count(r._id.toString()),
  }));

  return (
    <NamedResourceManager
      resource="vendors"
      singular="Vendor"
      description="Media / space vendors used on campaigns."
      items={items}
    />
  );
}
