import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { sendMail } from "@/lib/mailer";
import { buildSharePreviewMail } from "@/lib/mail/share-preview";
import { decryptSecret } from "@/lib/crypto";
import {
  baseUrlFrom,
  ensureCampaignShare,
  findOwnedCampaignForShare,
  getSharePreview,
  recordShareSend,
  sharePagePath,
} from "@/lib/share";
import { authGuard, badRequest, notFound, ok } from "@/lib/api";
import { isValidId } from "@/lib/services";
import type { ShareSendResult } from "@/lib/view-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Email the campaign's sales person a link to its photos. The link is public,
 * token-gated and never expires (see models/campaign-share.ts) — from it they
 * can browse every location, download files and export the execution deck
 * without an account.
 *
 * Sending twice mails the same URL: the token is minted once per campaign, so
 * an older mail keeps working.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  await connectDB();
  const campaign = await findOwnedCampaignForShare(auth.session.userId, id);
  if (!campaign) return notFound("Campaign not found");

  const user = await User.findById(auth.session.userId);
  if (!user) return notFound("User not found");

  const sales = campaign.salesId as unknown as { name: string; email: string };
  if (!sales?.email) return badRequest("This campaign has no sales email");

  const share = await ensureCampaignShare(auth.session.userId, id);
  const base = baseUrlFrom(req);
  const previewUrl = `${base}${sharePagePath(share.token)}`;

  // Read back through the same payload the preview page renders, so the mail's
  // counts and thumbnails can never disagree with what the link opens on.
  const preview = await getSharePreview(share.token);
  if (!preview) return notFound("Campaign not found");
  if (preview.fileCount === 0) {
    return badRequest("This campaign has no images to share yet");
  }

  try {
    await sendMail({
      fromName: user.name,
      fromEmail: user.email,
      appPassword: decryptSecret(user.appPassword),
      to: sales.email,
      message: buildSharePreviewMail({
        fromName: user.name,
        salesName: sales.name,
        clientName: preview.clientName,
        previewUrl,
        fileCount: preview.fileCount,
        locationCount: preview.locations.length,
      }),
    });
  } catch (err) {
    // The token is already minted and permanently valid, so the link comes
    // back even though the mail didn't go out — a bad SMTP password shouldn't
    // leave the user with nothing to paste into a chat window.
    return NextResponse.json(
      {
        error: err instanceof Error ? `Email failed: ${err.message}` : "Email failed",
        url: previewUrl,
      },
      { status: 400 },
    );
  }

  // Bookkeeping only, and deliberately after the send — a failed mail should
  // not leave a "last sent" stamp behind.
  await recordShareSend(id, sales.email);

  return ok({
    ok: true,
    url: previewUrl,
    sentTo: sales.email,
    fileCount: preview.fileCount,
  } satisfies ShareSendResult);
}
