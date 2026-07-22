import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { MailMessage } from "@/lib/mail/shared";


export function createTransport(fromEmail: string, appPassword: string) {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: fromEmail,
      pass: appPassword,
    },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });
}

/** An addressed message. The body itself comes from `@/lib/mail/*`. */
export type Envelope = {
  fromName: string;
  fromEmail: string;
  to: string;
  message: MailMessage;
};

const MAIL_DISABLED = process.env.MAIL_DISABLED === "1";

/** Send over an existing (already authenticated) transport. */
export async function sendMailWith(transport: Transporter, input: Envelope) {
  if (MAIL_DISABLED) {
    console.warn(
      `[mail] MAIL_DISABLED — suppressed "${input.message.subject}" to ${input.to}`,
    );
    return null;
  }
  return transport.sendMail({
    from: `"${input.fromName}" <${input.fromEmail}>`,
    to: input.to,
    subject: input.message.subject,
    text: input.message.text,
    html: input.message.html,
  });
}

/** Send a single one-off message, opening and closing its own transport. */
export async function sendMail(input: Envelope & { appPassword: string }) {
  const transport = createTransport(input.fromEmail, input.appPassword);
  try {
    return await sendMailWith(transport, input);
  } finally {
    transport.close();
  }
}
