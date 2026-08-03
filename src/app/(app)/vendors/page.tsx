import { requireSession } from "@/lib/auth";
import { NamedResourceManager } from "@/components/named-resource-manager";

export default async function VendorsPage() {
  await requireSession();

  return (
    <NamedResourceManager
      resource="vendors"
      singular="Vendor"
      description="Media / space vendors used on campaigns. Shared across the whole team."
    />
  );
}
