import "server-only";
import { connectDB } from "@/lib/db";
import { Reminder } from "@/models";
import { sendReminderEmail } from "@/lib/mailer";
import { daysUntil, startOfDay } from "@/lib/campaign";
import { decryptSecret } from "@/lib/crypto";

export type ReminderRunResult = {
  date: string;
  due: number;
  sent: number;
  skipped: number;
  errors: { campaignId: string; error: string }[];
};

/**
 * Find every unsent reminder scheduled for `now`'s day or earlier (catching up
 * on any backlog from days the job didn't run) and email the campaign's sales
 * person, using the days-remaining as of today. Called by the daily cron
 * route. Idempotent: reminders are marked sent, so re-running won't double-send.
 */
export async function runDueReminders(
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  await connectDB();

  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const due = await Reminder.find({
    sent: false,
    date: { $lt: dayEnd },
  })
    .populate({
      path: "campaignId",
      populate: [
        { path: "salesId", select: "name email" },
        { path: "vendorId", select: "name" },
        { path: "clientId", select: "name" },
        { path: "userId", select: "name email appPassword" },
      ],
    })
    .exec();

  const result: ReminderRunResult = {
    date: dayStart.toISOString(),
    due: due.length,
    sent: 0,
    skipped: 0,
    errors: [],
  };

  for (const reminder of due) {
    const campaign = reminder.campaignId as unknown as {
      _id: unknown;
      city: string;
      type: string;
      location: string;
      status: string;
      endDate: Date;
      salesId?: { name: string; email: string };
      vendorId?: { name: string };
      clientId?: { name: string };
      userId?: { name: string; email: string; appPassword: string };
    } | null;

    // Campaign / relations may have been deleted, or campaign already ended.
    if (
      !campaign ||
      !campaign.salesId ||
      !campaign.userId ||
      campaign.status === "ENDED"
    ) {
      result.skipped++;
      continue;
    }

    try {
      await sendReminderEmail({
        fromName: campaign.userId.name,
        fromEmail: campaign.userId.email,
        appPassword: decryptSecret(campaign.userId.appPassword),
        to: campaign.salesId.email,
        salesName: campaign.salesId.name,
        clientName: campaign.clientId?.name ?? "—",
        vendorName: campaign.vendorId?.name ?? "—",
        city: campaign.city,
        type: campaign.type,
        location: campaign.location,
        endDate: new Date(campaign.endDate),
        daysLeft: Math.max(0, daysUntil(new Date(campaign.endDate), now)),
        appUrl: process.env.APP_URL ?? "http://localhost:3000",
      });

      reminder.sent = true;
      reminder.sentAt = new Date();
      await reminder.save();
      result.sent++;
    } catch (err) {
      result.errors.push({
        campaignId: String(campaign._id),
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return result;
}
