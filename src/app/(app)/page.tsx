import { requireSession } from "@/lib/auth";
import {
  getCampaigns,
  getClientList,
  getSalesList,
  getVendorList,
} from "@/lib/data";
import { CampaignManager } from "@/components/campaign-manager";

export default async function CampaignsPage() {
  const session = await requireSession();
  const [campaigns, clients, sales, vendors] = await Promise.all([
    getCampaigns(session.userId),
    getClientList(session.userId),
    getSalesList(session.userId),
    getVendorList(session.userId),
  ]);

  return (
    <CampaignManager
      campaigns={campaigns}
      options={{ clients, sales, vendors }}
    />
  );
}
