import { requireSession } from "@/lib/auth";
import { getCampaigns } from "@/lib/data";
import { ImagesManager } from "@/components/images-manager";

export default async function ImagesPage() {
  const session = await requireSession();
  const campaigns = await getCampaigns(session.userId);

  return <ImagesManager campaigns={campaigns} />;
}
