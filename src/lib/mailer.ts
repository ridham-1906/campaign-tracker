import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Build a Gmail transport for a given backend user, using the app password
 * stored on their account. Each user sends from their own mailbox.
 *
 * Pass `pool: true` when sending a batch for the same user (the cron job):
 * one authenticated connection is reused across messages instead of paying
 * the connect+TLS+auth handshake per email, which is what makes a serverless
 * batch run slow enough to hit the function timeout.
 */
export function createTransport(
  fromEmail: string,
  appPassword: string,
  { pool = false }: { pool?: boolean } = {},
) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: fromEmail,
      pass: appPassword,
    },
    ...(pool ? { pool: true, maxConnections: 1, maxMessages: 100 } : {}),
  });
}

/** One expiring placement, as it appears in the reminder email. */
export type ReminderLocation = {
  location: string;
  city: string;
  type: string;
  endDate: Date;
  daysLeft: number;
};

/** Everything needed to compose the email — no credentials. */
export type ReminderMessageInput = {
  fromName: string;
  fromEmail: string;
  to: string;
  salesName: string;
  clientName: string;
  /** The locations that are due — never empty. */
  locations: ReminderLocation[];
};

/** A message plus the credentials to open a transport for it. */
export type ReminderEmailInput = ReminderMessageInput & { appPassword: string };

/** Names come from user input and land in an HTML document. */
function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDay(d: Date) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildReminder(input: ReminderMessageInput) {
  const { locations } = input;
  const many = locations.length > 1;
  const soonest = Math.min(...locations.map((l) => l.daysLeft));

  const subject = many
    ? `Reminder: ${input.clientName} campaign - ${locations.length} locations expiring soon`
    : `Reminder: ${input.clientName} campaign in ${locations[0].city} expires in ${soonest} day${
        soonest === 1 ? "" : "s"
      }`;

  const intro = many
    ? `Hi ${input.salesName}, ${locations.length} locations in the ${input.clientName} campaign are about to end.`
    : `Hi ${input.salesName}, a location in the ${input.clientName} campaign is about to end.`;

  const cards = locations
    .map((l) =>
      `<div style="margin:0 0 12px;border:1px solid #dbe3ee;border-radius:8px;background:#ffffff;overflow:hidden">
        <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e5eaf0">
          <div style="margin:0 0 4px;color:#667085;font-size:11px;font-weight:700;letter-spacing:.02em">Location</div>
          <div style="color:#111827;font-size:15px;font-weight:700;line-height:1.45;word-break:break-word">${escapeHtml(l.location)}</div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
          <tbody>
            <tr>
              <td style="width:50%;padding:10px 14px;border-right:1px solid #edf1f5;border-bottom:1px solid #edf1f5;vertical-align:top">
                <div style="margin:0 0 3px;color:#667085;font-size:11px;font-weight:700">City</div>
                <div style="color:#111827;font-size:14px;line-height:1.4;word-break:break-word">${escapeHtml(l.city)}</div>
              </td>
              <td style="width:50%;padding:10px 14px;border-bottom:1px solid #edf1f5;vertical-align:top">
                <div style="margin:0 0 3px;color:#667085;font-size:11px;font-weight:700">Type</div>
                <div style="color:#111827;font-size:14px;line-height:1.4;word-break:break-word">${escapeHtml(l.type)}</div>
              </td>
            </tr>
            <tr>
              <td style="width:50%;padding:10px 14px;border-right:1px solid #edf1f5;vertical-align:top">
                <div style="margin:0 0 3px;color:#667085;font-size:11px;font-weight:700">End date</div>
                <div style="color:#111827;font-size:14px;line-height:1.4">${escapeHtml(formatDay(l.endDate))}</div>
              </td>
              <td style="width:50%;padding:10px 14px;vertical-align:top">
                <div style="margin:0 0 3px;color:#667085;font-size:11px;font-weight:700">Days left</div>
                <div style="display:inline-block;padding:3px 8px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:13px;font-weight:700;line-height:1.4">${escapeHtml(String(l.daysLeft))}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>`,
    )
    .join("");

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;color:#111827;background:#ffffff">
    <h2 style="margin:0 0 6px;font-size:20px;line-height:1.25;color:#111827">Campaign expiring soon</h2>
    <p style="color:#475467;margin:0 0 12px;font-size:14px;line-height:1.5">${escapeHtml(intro)}</p>
    <p style="margin:0 0 16px;padding:10px 12px;border-left:4px solid #f59e0b;background:#fffbeb;color:#92400e;font-size:14px;line-height:1.45;font-weight:600">Kindly update on renewal status.</p>
    <div>${cards}</div>

    <p style="color:#98a2b3;font-size:12px;margin-top:20px;line-height:1.4">Sent by ${escapeHtml(input.fromName)} via Campaign Tracker</p>
  </div>`;

  const lines = locations
    .map(
      (l) =>
        `- ${l.location} (${l.city}, ${l.type}) - ends ${formatDay(l.endDate)}, ${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left`,
    )
    .join("\n");

  const text = `Campaign expiring soon
${intro}

Kindly update on renewal status.

${lines}
`;

  return {
    from: `"${input.fromName}" <${input.fromEmail}>`,
    to: input.to,
    subject,
    text,
    html,
  };
}

/** Send one reminder over an existing (already authenticated) transport. */
export async function sendReminderWith(
  transport: Transporter,
  input: ReminderMessageInput,
) {
  return transport.sendMail(buildReminder(input));
}

/** Send a single one-off reminder, opening and closing its own transport. */
export async function sendReminderEmail(input: ReminderEmailInput) {
  const transport = createTransport(input.fromEmail, input.appPassword);
  try {
    return await sendReminderWith(transport, input);
  } finally {
    transport.close();
  }
}
