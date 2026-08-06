import { requireSession } from "@/lib/auth";
import { CampaignManager } from "@/components/campaign-manager";

export default async function CampaignsPage() {
  // Campaigns are fetched client-side through /api/campaigns so the table can
  // page, search, sort and status-filter against the database; the page only
  // gates access.
  const session = await requireSession();

  return <CampaignManager isAdmin={session.isAdmin} currentUserId={session.userId} />;
}
