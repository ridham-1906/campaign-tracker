import { formatDay, layout, locationCard, type MailMessage } from "./shared";

/** One of the vendor's live sites on the campaign. */
export type VendorLocation = {
  location: string;
  city: string;
  medium: string;
  startDate: Date;
  endDate: Date;
  daysLeft: number;
};

export type VendorReminderInput = {
  fromName: string;
  vendorName: string;
  clientName: string;
  /** The vendor's live sites — never empty. */
  locations: VendorLocation[];
};

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * Sent to a vendor on one of its chosen reminder dates. Covers every LIVE site
 * the vendor has on the campaign — never another vendor's, and never one that
 * has ended or is still waiting on creative.
 */
export function buildVendorReminder(input: VendorReminderInput): MailMessage {
  const locations = [...input.locations].sort((a, b) => a.daysLeft - b.daysLeft);
  const n = locations.length;

  const subject = `Site update: ${input.clientName} campaign - ${n} live site${plural(n)}`;

  const intro =
    n > 1
      ? `Hi ${input.vendorName}, here is the status of your ${n} live sites on the ${input.clientName} campaign.`
      : `Hi ${input.vendorName}, here is the status of your live site on the ${input.clientName} campaign.`;

  const callout = "Please check the end dates below.";

  const body = locations
    .map((l) =>
      locationCard(l.location, [
        { label: "City", value: l.city },
        { label: "Medium", value: l.medium },
        { label: "Start date", value: formatDay(l.startDate) },
        { label: "End date", value: formatDay(l.endDate) },
        {
          label: "Days left",
          value: String(l.daysLeft),
          pill: { bg: "#fff7ed", fg: "#c2410c" },
        },
        {
          label: "Status",
          value: "Live",
          pill: { bg: "#ecfdf3", fg: "#067647" },
        },
      ]),
    )
    .join("");

  const lines = locations
    .map(
      (l) =>
        `- ${l.location} (${l.city}, ${l.medium}) - Live, ends ${formatDay(l.endDate)}, ${l.daysLeft} day${plural(l.daysLeft)} left`,
    )
    .join("\n");

  return {
    subject,
    text: `Site update\n${intro}\n\n${callout}\n\n${lines}\n`,
    html: layout({
      heading: "Site update",
      intro,
      callout: {
        text: callout,
        border: "#f59e0b",
        bg: "#fffbeb",
        fg: "#92400e",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
