import { requireSession } from "@/lib/auth";
import { CampaignDetail } from "@/components/campaign-detail";

type Params = { params: Promise<{ id: string }> };

/**
 * One campaign, reached by clicking its row on either the Campaigns screen or
 * the Dashboard — both used to expand the row in place; this replaces that
 * with a real page carrying its own URL, so it's shareable and back/forward
 * work normally.
 */
export default async function CampaignDetailPage({ params }: Params) {
  const { id } = await params;
  const session = await requireSession();

  return (
    <CampaignDetail id={id} isAdmin={session.isAdmin} currentUserId={session.userId} />
  );
}
