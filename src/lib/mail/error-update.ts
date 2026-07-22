import { escapeHtml, formatStamp, layout, type MailMessage } from "./shared";

/** Where reminder-run failures are reported. */
export const ERROR_REPORT_TO = process.env.REMINDER_ERROR_REPORT_TO;

export type ReminderFailure = {
  at: Date;
  campaignId: string;
  clientName: string;
  error: string;
};

export type ErrorUpdateInput = {
  fromName: string;
  /** The mailbox the failing campaigns belong to. */
  ownerEmail: string;
  failures: ReminderFailure[];
};

export function buildErrorUpdate(input: ErrorUpdateInput): MailMessage {
  const { failures } = input;
  const n = failures.length;

  const rows = failures
    .map(
      (f) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #edf1f5;font-size:13px;color:#475467;white-space:nowrap">${escapeHtml(formatStamp(f.at))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #edf1f5;font-size:13px;color:#111827">${escapeHtml(f.clientName)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #edf1f5;font-size:12px;color:#667085;font-family:monospace">${escapeHtml(f.campaignId)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #edf1f5;font-size:13px;color:#b42318">${escapeHtml(f.error)}</td>
      </tr>`,
    )
    .join("");

  const body = `<div style="overflow-x:auto">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #dbe3ee;border-radius:8px">
        <thead>
          <tr style="background:#f8fafc">
            <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5eaf0;font-size:11px;color:#667085">Timestamp</th>
            <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5eaf0;font-size:11px;color:#667085">Client</th>
            <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5eaf0;font-size:11px;color:#667085">Campaign</th>
            <th align="left" style="padding:8px 10px;border-bottom:1px solid #e5eaf0;font-size:11px;color:#667085">Error</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const lines = failures
    .map(
      (f) =>
        `- ${formatStamp(f.at)} | ${f.clientName} | ${f.campaignId} | ${f.error}`,
    )
    .join("\n");

  const intro = `${n} reminder email${n === 1 ? "" : "s"} failed to send from ${input.ownerEmail}.`;

  return {
    subject: `Campaign Tracker: ${n} reminder failure${n === 1 ? "" : "s"}`,
    text: `Reminder failures\n${intro}\n\n${lines}\n`,
    html: layout({
      heading: "Reminder failures",
      intro,
      callout: {
        text: "These reminders were not delivered. They retry on the next hourly run.",
        border: "#ef4444",
        bg: "#fef2f2",
        fg: "#991b1b",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
