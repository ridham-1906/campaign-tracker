import { requireSession } from "@/lib/auth";
import { CampaignManager } from "@/components/campaign-manager";

export default async function CampaignsPage() {
  // Campaigns are fetched client-side through /api/campaigns so the table can
  // page, search, sort and status-filter against the database; the page only
  // gates access.
  await requireSession();

  return <CampaignManager />;
}
