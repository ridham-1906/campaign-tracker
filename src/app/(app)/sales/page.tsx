import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { Campaign, Sales } from "@/models";
import { SalesManager } from "@/components/sales-manager";

export default async function SalesPage() {
  const session = await requireSession();
  await connectDB();
  const [rows, campaigns] = await Promise.all([
    Sales.find({ userId: session.userId }).sort({ name: 1 }).lean(),
    Campaign.find({ userId: session.userId }).select("salesId").lean(),
  ]);
  const count = (id: string) =>
    campaigns.filter((c) => String(c.salesId) === id).length;

  const items = rows.map((r) => ({
    id: r._id.toString(),
    name: r.name,
    email: r.email,
    count: count(r._id.toString()),
  }));

  return <SalesManager items={items} />;
}
