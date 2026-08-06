import { formatDay, layout, locationCard, type MailMessage } from "./shared";

/** One placement still waiting on its creative. */
export type CreativeLocation = {
  location: string;
  city: string;
  medium: string;
  startDate: Date;
  endDate: Date;
};

export type CreativeReminderInput = {
  fromName: string;
  salesName: string;
  clientName: string;
  /** The locations still pending — never empty. */
  locations: CreativeLocation[];
};

export function buildCreativeReminder(
  input: CreativeReminderInput,
): MailMessage {
  const { locations } = input;
  const many = locations.length > 1;

  const subject = `Creative pending: ${input.clientName} campaign - ${locations.length} location${many ? "s" : ""}`;

  const intro = many
    ? `Hi ${input.salesName}, ${locations.length} locations in the ${input.clientName} campaign are still waiting on their creative.`
    : `Hi ${input.salesName}, a location in the ${input.clientName} campaign is still waiting on its creative.`;

  const body = locations
    .map((l) =>
      locationCard(l.location, [
        { label: "City", value: l.city },
        { label: "Medium", value: l.medium },
        { label: "Start date", value: formatDay(l.startDate) },
        { label: "End date", value: formatDay(l.endDate) },
      ]),
    )
    .join("");

  const lines = locations
    .map(
      (l) =>
        `- ${l.location} (${l.city}, ${l.medium}) - runs ${formatDay(l.startDate)} to ${formatDay(l.endDate)}`,
    )
    .join("\n");

  return {
    subject,
    text: `Creative pending\n${intro}\n\nKindly share the creative so the site can go live.\n\n${lines}\n`,
    html: layout({
      heading: "Creative pending",
      intro,
      callout: {
        text: "Kindly share the creative so the site can go live.",
        border: "#3b82f6",
        bg: "#eff6ff",
        fg: "#1e40af",
      },
      body,
      fromName: input.fromName,
    }),
  };
}
