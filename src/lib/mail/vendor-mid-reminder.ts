import { formatDay, layout, locationCard, type MailMessage } from "./shared";

/** One of the vendor's sites due (or overdue) for its mid-point check. */
export type MidMonitoringLocation = {
  location: string;
  city: string;
  medium: string;
  startDate: Date;
  midDate: Date;
  endDate: Date;
};

export type VendorMidReminderInput = {
  fromName: string;
  vendorName: string;
  clientName: string;
  /** Sites still missing their mid-point photo — never empty. */
  locations: MidMonitoringLocation[];
};

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * Sent to a vendor once a site's mid date arrives, asking for the mid-campaign
 * monitoring photo. Repeats daily (see lib/reminders/vendor.ts) until the
 * photo is uploaded against that location, at which point it stops for good.
 */
export function buildVendorMidReminder(input: VendorMidReminderInput): MailMessage {
  const locations = [...input.locations].sort(
    (a, b) => a.midDate.getTime() - b.midDate.getTime(),
  );
  const n = locations.length;

  const subject = `Mid-point photo needed: ${input.clientName} campaign - ${n} site${plural(n)}`;

  const intro =
    n > 1
      ? `Hi ${input.vendorName}, ${n} of your sites on the ${input.clientName} campaign have reached their mid-point check.`
      : `Hi ${input.vendorName}, a site of yours on the ${input.clientName} campaign has reached its mid-point check.`;

  const callout = "Kindly share the mid-point monitoring photo for these sites.";

  const body = locations
    .map((l) =>
      locationCard(l.location, [
        { label: "City", value: l.city },
        { label: "Medium", value: l.medium },
        { label: "Mid date", value: formatDay(l.midDate) },
        { label: "End date", value: formatDay(l.endDate) },
      ]),
    )
    .join("");

  const lines = locations
    .map(
      (l) =>
        `- ${l.location} (${l.city}, ${l.medium}) - mid date ${formatDay(l.midDate)}`,
    )
    .join("\n");

  return {
    subject,
    text: `Mid-point photo needed\n${intro}\n\n${callout}\n\n${lines}\n`,
    html: layout({
      heading: "Mid-point photo needed",
      intro,
      callout: {
        text: callout,
        border: "#3b82f6",
        bg: "#eff6ff",
        fg: "#1e40af",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
