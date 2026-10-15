import { requireSession } from "@/lib/auth";
import { SalesManager } from "@/components/sales-manager";

export default async function SalesPage() {
  const session = await requireSession();

  return <SalesManager isAdmin={session.isAdmin} currentUserId={session.userId} />;
}
