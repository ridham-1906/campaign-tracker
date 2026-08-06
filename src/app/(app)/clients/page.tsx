import { requireSession } from "@/lib/auth";
import { NamedResourceManager } from "@/components/named-resource-manager";

export default async function ClientsPage() {
  // Data is fetched client-side through /api/clients so the table can page,
  // search and sort against the database; the page only gates access.
  await requireSession();

  return (
    <NamedResourceManager
      resource="clients"
      singular="Client"
      description="Advertisers / brands the campaigns run for. Shared across the whole team."
    />
  );
}
