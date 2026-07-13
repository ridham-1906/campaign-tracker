import "server-only";
import nodemailer from "nodemailer";

/**
 * Build a Gmail transport for a given backend user, using the app password
 * stored on their account. Each user sends from their own mailbox.
 */
export function createTransport(fromEmail: string, appPassword: string) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: fromEmail,
      pass: appPassword,
    },
  });
}

export type ReminderEmailInput = {
  fromName: string;
  fromEmail: string;
  appPassword: string;
  to: string;
  salesName: string;
  clientName: string;
  vendorName: string;
  city: string;
  type: string;
  location: string;
  endDate: Date;
  daysLeft: number;
  appUrl: string;
};

export async function sendReminderEmail(input: ReminderEmailInput) {
  const transport = createTransport(input.fromEmail, input.appPassword);

  const end = input.endDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `Reminder: ${input.clientName} campaign in ${input.city} expires in ${input.daysLeft} day${
    input.daysLeft === 1 ? "" : "s"
  }`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">Campaign expiring soon</h2>
    <p style="color:#555;margin:0 0 16px">Hi ${input.salesName}, one of your campaigns is about to end.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tbody>
        ${row("Client", input.clientName)}
        ${row("Vendor", input.vendorName)}
        ${row("Type", input.type)}
        ${row("City", input.city)}
        ${row("Location", input.location)}
        ${row("End date", end)}
        ${row("Days left", String(input.daysLeft))}
      </tbody>
    </table>
    
    <p style="color:#999;font-size:12px;margin-top:24px">Sent by ${input.fromName} via Campaign Tracker</p>
  </div>`;

  const text = `Campaign expiring soon
Hi ${input.salesName}, one of your campaigns is about to end.

Client:   ${input.clientName}
Vendor:   ${input.vendorName}
Type:     ${input.type}
City:     ${input.city}
Location: ${input.location}
End date: ${end}
Days left: ${input.daysLeft}

`;

  return transport.sendMail({
    from: `"${input.fromName}" <${input.fromEmail}>`,
    to: input.to,
    subject,
    text,
    html,
  });
}

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888">${label}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600">${value}</td>
  </tr>`;
}
