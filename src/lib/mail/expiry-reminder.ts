import { formatDay, layout, locationCard, type MailMessage } from "./shared";

/** One expiring placement, as it appears in the reminder email. */
export type ExpiryLocation = {
  location: string;
  city: string;
  type: string;
  endDate: Date;
  daysLeft: number;
};

export type ExpiryReminderInput = {
  fromName: string;
  salesName: string;
  clientName: string;
  /** The locations that are due — never empty. */
  locations: ExpiryLocation[];
};

const plural = (n: number) => (n === 1 ? "" : "s");

export function buildExpiryReminder(input: ExpiryReminderInput): MailMessage {
  const { locations } = input;
  const many = locations.length > 1;
  const soonest = Math.min(...locations.map((l) => l.daysLeft));

  const subject = many
    ? `Reminder: ${input.clientName} campaign - ${locations.length} locations expiring soon`
    : `Reminder: ${input.clientName} campaign in ${locations[0].city} expires in ${soonest} day${plural(soonest)}`;

  const intro = many
    ? `Hi ${input.salesName}, ${locations.length} locations in the ${input.clientName} campaign are about to end.`
    : `Hi ${input.salesName}, a location in the ${input.clientName} campaign is about to end.`;

  const body = locations
    .map((l) =>
      locationCard(l.location, [
        { label: "City", value: l.city },
        { label: "Type", value: l.type },
        { label: "End date", value: formatDay(l.endDate) },
        {
          label: "Days left",
          value: String(l.daysLeft),
          pill: { bg: "#fff7ed", fg: "#c2410c" },
        },
      ]),
    )
    .join("");

  const lines = locations
    .map(
      (l) =>
        `- ${l.location} (${l.city}, ${l.type}) - ends ${formatDay(l.endDate)}, ${l.daysLeft} day${plural(l.daysLeft)} left`,
    )
    .join("\n");

  return {
    subject,
    text: `Campaign expiring soon\n${intro}\n\nKindly update on renewal status.\n\n${lines}\n`,
    html: layout({
      heading: "Campaign expiring soon",
      intro,
      callout: {
        text: "Kindly update on renewal status.",
        border: "#f59e0b",
        bg: "#fffbeb",
        fg: "#92400e",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
