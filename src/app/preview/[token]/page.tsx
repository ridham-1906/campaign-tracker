import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharePreview } from "@/lib/share";
import { SharedCampaignPreview } from "@/components/shared-campaign-preview";

// Outside the (app) route group on purpose: no sidebar, no session. The token
// in the path is the credential, and it never expires — see
// models/campaign-share.ts.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

// generateMetadata and the page render in the same request, so one read
// serves both.
const load = cache(getSharePreview);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const preview = await load(token);
  return {
    title: preview
      ? `${preview.clientName} · Campaign photos`
      : "Preview unavailable",
    // A link this public should never be indexed — it's meant to be reached
    // from the email it was sent in, not from a search result.
    robots: { index: false, follow: false },
  };
}

export default async function PreviewPage({ params }: Params) {
  const { token } = await params;
  const preview = await load(token);
  if (!preview) notFound();

  return <SharedCampaignPreview data={preview} />;
}
