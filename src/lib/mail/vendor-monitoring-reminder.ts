import { formatDay, layout, locationCard, type MailMessage } from "./shared";
import type { AttachmentStage } from "@/lib/attachments";

/** One of the vendor's sites that reached a stage's checkpoint date. */
export type MonitoringLocation = {
  location: string;
  startDate: Date;
  /** Not every location has one. */
  midDate: Date | null;
  endDate: Date;
};

export type VendorMonitoringReminderInput = {
  fromName: string;
  vendorName: string;
  clientName: string;
  /** Which checkpoint this ask is for — installation/mid/end. */
  stage: AttachmentStage;
  /** Sites still missing that stage's photo — never empty. */
  locations: MonitoringLocation[];
};

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * Copy that differs per stage. Installation fires from a site's start date,
 * mid from its mid date, end from its end date — the field each reads is
 * MONITORING_STAGES in lib/reminders/vendor.ts, which this must stay in sync
 * with (same three AttachmentStage keys).
 */
const STAGE_COPY: Record<
  AttachmentStage,
  {
    subjectPrefix: string;
    heading: string;
    dateLabel: string;
    dateOf: (l: MonitoringLocation) => Date;
    reachedPlural: string;
    reachedSingular: string;
    callout: string;
  }
> = {
  installation: {
    subjectPrefix: "Installation photo needed",
    heading: "Installation photo needed",
    dateLabel: "Start date",
    dateOf: (l) => l.startDate,
    reachedPlural: "have started and need their installation photo",
    reachedSingular: "has started and needs its installation photo",
    callout: "Kindly share the installation photo for these sites.",
  },
  mid_date: {
    subjectPrefix: "Mid-date photo needed",
    heading: "Mid-date photo needed",
    dateLabel: "Mid date",
    dateOf: (l) => l.midDate!,
    reachedPlural: "have reached their mid-dated check",
    reachedSingular: "has reached its mid-dated check",
    callout: "Kindly share the mid-dated monitoring photo for these sites.",
  },
  end_date: {
    subjectPrefix: "Closing photo needed",
    heading: "Closing photo needed",
    dateLabel: "End date",
    dateOf: (l) => l.endDate,
    reachedPlural: "have reached their end date and need their closing photo",
    reachedSingular: "has reached its end date and needs its closing photo",
    callout: "Kindly share the closing photo for these sites.",
  },
};

/**
 * Sent to a vendor once a site reaches the checkpoint date for `stage`
 * (start/mid/end), asking for that stage's photo. Repeats daily (see
 * runVendorMonitoringReminders in lib/reminders/vendor.ts) until a photo of
 * that stage is uploaded against the location, at which point it stops for
 * good.
 */
export function buildVendorMonitoringReminder(
  input: VendorMonitoringReminderInput,
): MailMessage {
  const copy = STAGE_COPY[input.stage];
  const locations = [...input.locations].sort(
    (a, b) => copy.dateOf(a).getTime() - copy.dateOf(b).getTime(),
  );
  const n = locations.length;

  const subject = `${copy.subjectPrefix}: ${input.clientName} campaign - ${n} site${plural(n)}`;

  const intro =
    n > 1
      ? `Hi ${input.vendorName}, ${n} of your sites on the ${input.clientName} campaign ${copy.reachedPlural}.`
      : `Hi ${input.vendorName}, a site of yours on the ${input.clientName} campaign ${copy.reachedSingular}.`;

  const callout = copy.callout;

  // Every stage's card shows the same three dates, so the vendor sees the
  // site's full run at a glance rather than just the date that triggered it.
  const body = locations
    .map((l) =>
      locationCard(l.location, [
        { label: "Start date", value: formatDay(l.startDate) },
        ...(l.midDate ? [{ label: "Mid date", value: formatDay(l.midDate) }] : []),
        { label: "End date", value: formatDay(l.endDate) },
      ]),
    )
    .join("");

  const lines = locations
    .map((l) => {
      const mid = l.midDate ? `, mid ${formatDay(l.midDate)}` : "";
      return `- ${l.location} - start ${formatDay(l.startDate)}${mid}, end ${formatDay(l.endDate)}`;
    })
    .join("\n");

  return {
    subject,
    text: `${copy.heading}\n${intro}\n\n${callout}\n\n${lines}\n`,
    html: layout({
      heading: copy.heading,
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
