import { escapeHtml, layout, type MailMessage } from "./shared";

/**
 * The "here are your campaign photos" mail: a counts summary and a link to the
 * preview page, where the whole campaign can be browsed, downloaded and
 * exported as a deck.
 *
 * Deliberately image-free — no thumbnails ride along. The photos live behind
 * the link, so nothing here depends on a mail client (or Gmail's proxy) being
 * able to reach the app.
 */

export type SharePreviewInput = {
  fromName: string;
  salesName: string;
  clientName: string;
  /** Absolute URL of the preview page. */
  previewUrl: string;
  fileCount: number;
  /** Only the count — the per-location breakdown lives on the preview page. */
  locationCount: number;
};

/** The primary call to action, plus the raw URL underneath for the clients
 * that strip buttons or for anyone who wants to forward the address itself. */
function callToAction(previewUrl: string) {
  const safe = escapeHtml(previewUrl);
  return `<div style="margin:0 0 18px">
      <a href="${safe}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#111827;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">Open photo preview</a>
      <div style="margin:10px 0 0;color:#667085;font-size:12px;line-height:1.5;word-break:break-all">${safe}</div>
    </div>`;
}

export function buildSharePreviewMail(input: SharePreviewInput): MailMessage {
  const { locationCount, fileCount } = input;

  const subject = `${input.clientName} campaign photos - ${fileCount} file${fileCount === 1 ? "" : "s"} ready to view`;

  const intro =
    `Hi ${input.salesName}, the photos for the ${input.clientName} campaign are ready. ` +
    `${fileCount} file${fileCount === 1 ? "" : "s"} across ${locationCount} location${locationCount === 1 ? "" : "s"}.`;

  const body = callToAction(input.previewUrl);

  return {
    subject,
    text:
      `Campaign photos ready\n${intro}\n\n` +
      `Open the preview to view every photo, download them, or export the execution deck:\n${input.previewUrl}\n\n` +
      `This link does not expire.\n`,
    html: layout({
      heading: "Campaign photos ready",
      intro,
      callout: {
        text: "Open the link to view every photo, download them, or export the execution deck. The link does not expire.",
        border: "#16a34a",
        bg: "#f0fdf4",
        fg: "#166534",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
