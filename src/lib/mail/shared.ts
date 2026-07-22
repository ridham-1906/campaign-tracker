// Building blocks shared by every email template, so all three keep one look.

/** A rendered email, ready to hand to a transport. */
export type MailMessage = { subject: string; text: string; html: string };

/** Names come from user input and land in an HTML document. */
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Dates are stored as UTC midnight, so render them in UTC too. */
export function formatDay(d: Date) {
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatStamp(d: Date) {
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** A value cell, optionally rendered as a coloured pill. */
export type CardRow = {
  label: string;
  value: string;
  pill?: { bg: string; fg: string };
};

function cell(row: CardRow, style: string) {
  const value = row.pill
    ? `<div style="display:inline-block;padding:3px 8px;border-radius:999px;background:${row.pill.bg};color:${row.pill.fg};font-size:13px;font-weight:700;line-height:1.4">${escapeHtml(row.value)}</div>`
    : `<div style="color:#111827;font-size:14px;line-height:1.4;word-break:break-word">${escapeHtml(row.value)}</div>`;
  return `<td style="width:50%;padding:10px 14px;${style}vertical-align:top">
        <div style="margin:0 0 3px;color:#667085;font-size:11px;font-weight:700">${escapeHtml(row.label)}</div>
        ${value}
      </td>`;
}

/** One bordered card: a titled header over a two-column grid of rows. */
export function locationCard(title: string, rows: CardRow[]) {
  const pairs: CardRow[][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));

  const body = pairs
    .map((pair, i) => {
      const under = i < pairs.length - 1 ? "border-bottom:1px solid #edf1f5;" : "";
      const cells = pair.map((row, col) =>
        cell(row, (col === 0 && pair.length === 2 ? "border-right:1px solid #edf1f5;" : "") + under),
      );
      if (pair.length === 1) cells.push('<td style="width:50%"></td>');
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `<div style="margin:0 0 12px;border:1px solid #dbe3ee;border-radius:8px;background:#ffffff;overflow:hidden">
      <div style="padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e5eaf0">
        <div style="margin:0 0 4px;color:#667085;font-size:11px;font-weight:700;letter-spacing:.02em">Location</div>
        <div style="color:#111827;font-size:15px;font-weight:700;line-height:1.45;word-break:break-word">${escapeHtml(title)}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/** Page chrome: heading, intro, a coloured callout, then the body. */
export function layout(input: {
  heading: string;
  intro: string;
  callout?: { text: string; border: string; bg: string; fg: string };
  body: string;
  fromName: string;
}) {
  const callout = input.callout
    ? `<p style="margin:0 0 16px;padding:10px 12px;border-left:4px solid ${input.callout.border};background:${input.callout.bg};color:${input.callout.fg};font-size:14px;line-height:1.45;font-weight:600">${escapeHtml(input.callout.text)}</p>`
    : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;color:#111827;background:#ffffff">
    <h2 style="margin:0 0 6px;font-size:20px;line-height:1.25;color:#111827">${escapeHtml(input.heading)}</h2>
    <p style="color:#475467;margin:0 0 12px;font-size:14px;line-height:1.5">${escapeHtml(input.intro)}</p>
    ${callout}
    <div>${input.body}</div>

    <p style="color:#98a2b3;font-size:12px;margin-top:20px;line-height:1.4">Sent by ${escapeHtml(input.fromName)} via Campaign Tracker</p>
  </div>`;
}
