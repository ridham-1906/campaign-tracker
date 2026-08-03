import "server-only";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, CampaignShare, User } from "@/models";
import { getCampaign } from "@/lib/data";
import type { LocationPreview, SharePreviewView } from "@/lib/view-types";

/**
 * Public, never-expiring preview links: one per campaign, addressed by an
 * unguessable token instead of a session. Everything a token holder can reach
 * goes through here, so the "what does this token unlock?" answer lives in one
 * file — the campaign it was minted for, and nothing else.
 */

/** 32 url-safe characters. The token is the only credential on the preview
 * page, so it comes from the CSPRNG, never from an id or a timestamp. */
function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/** Where a file behind a share token is streamed from — the public twin of
 * the session-gated attachment route. */
export function shareFileUrl(token: string, attachmentId: string) {
  return `/api/share/${token}/files/${attachmentId}`;
}

export function sharePagePath(token: string) {
  return `/preview/${token}`;
}

/**
 * The origin to build the emailed link from. Configuration wins, because the
 * request that mints the link may well arrive on localhost while the mail is
 * read anywhere; the forwarded headers are the deployment fallback, and the
 * request's own origin is the last resort for local use.
 */
export function baseUrlFrom(req: Request) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}

/**
 * The campaign's link, minted on first use and reused forever after. Upsert
 * rather than find-then-create so two rapid sends can't mint two tokens for
 * the same campaign — `campaignId` is unique, and `$setOnInsert` leaves an
 * existing token untouched.
 */
export async function ensureCampaignShare(userId: string, campaignId: string) {
  await connectDB();
  return CampaignShare.findOneAndUpdate(
    { campaignId },
    { $setOnInsert: { campaignId, userId, token: newToken() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

/** Note that a link was mailed. Bookkeeping only — it never gates access. */
export async function recordShareSend(campaignId: string, to: string) {
  await CampaignShare.updateOne(
    { campaignId },
    { $set: { lastSentTo: to, lastSentAt: new Date() }, $inc: { sendCount: 1 } },
  );
}

/**
 * Resolve a token to the campaign it unlocks. Returns null for an unknown
 * token or one whose campaign has since been deleted — both read as "this
 * link doesn't point at anything" to the visitor.
 */
export async function findShare(token: string) {
  if (!token || token.length > 128) return null;
  await connectDB();
  return CampaignShare.findOne({ token });
}

/**
 * Everything the public preview page renders. The campaign is read with the
 * admin-style `null` scope on purpose: the token already proved the caller may
 * see this one campaign, and the owning user isn't the one visiting.
 */
export async function getSharePreview(
  token: string,
): Promise<SharePreviewView | null> {
  const share = await findShare(token);
  if (!share) return null;

  const campaign = await getCampaign(null, String(share.campaignId));
  if (!campaign) return null;

  const sharer = await User.findById(share.userId).select("name").lean();

  let fileCount = 0;
  const locations: LocationPreview[] = campaign.locations.map((l) => {
    fileCount += l.attachments.length;
    return {
      id: l.id,
      city: l.city,
      location: l.location,
      medium: l.medium,
      type: l.type,
      width: l.width,
      height: l.height,
      sqft: l.sqft,
      startDate: l.startDate,
      midDate: l.midDate,
      endDate: l.endDate,
      // Re-pointed at the token-gated route: the session-gated URLs the read
      // layer builds would 401 for the very person this page is for.
      attachments: l.attachments.map((a) => ({
        ...a,
        url: shareFileUrl(token, a.id),
      })),
    };
  });

  return {
    token,
    clientName: campaign.client.name,
    sharedBy: sharer?.name ?? "Campaign Tracker",
    createdAt: new Date(share.createdAt ?? Date.now()).toISOString(),
    fileCount,
    locations,
  };
}

/**
 * One file behind a token. The campaign id comes from the share document, not
 * from the URL, so an attachment id belonging to another campaign can't be
 * read through someone else's link.
 */
export async function findSharedAttachment(token: string, attachmentId: string) {
  const share = await findShare(token);
  if (!share) return null;
  return Attachment.findOne({ _id: attachmentId, campaignId: share.campaignId });
}

/** How many files a campaign has — the "is there anything to share?" check. */
export async function countCampaignFiles(campaignId: string) {
  await connectDB();
  return Attachment.countDocuments({ campaignId });
}

/** A campaign the given user owns, with sales and client resolved — the one
 * lookup the send route needs. */
export async function findOwnedCampaignForShare(userId: string, campaignId: string) {
  await connectDB();
  return Campaign.findOne({ _id: campaignId, userId })
    .populate("salesId", "name email")
    .populate("clientId", "name");
}
