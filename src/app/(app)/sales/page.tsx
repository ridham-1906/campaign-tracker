import { requireSession } from "@/lib/auth";
import { SalesManager } from "@/components/sales-manager";

export default async function SalesPage() {
  await requireSession();

  return <SalesManager />;
}
