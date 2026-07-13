import { connectDB } from "@/lib/db";
import { Campaign, Reminder, User } from "@/models";
import { sendReminderEmail } from "@/lib/mailer";
import { decryptSecret } from "@/lib/crypto";
import { daysUntil } from "@/lib/campaign";
import { authGuard, badRequest, notFound, ok } from "@/lib/api";
import { isValidId } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Immediately email the campaign's sales person about its expiry. */
export async function POST(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  await connectDB();
  const campaign = await Campaign.findOne({
    _id: id,
    userId: auth.session.userId,
  })
    .populate("salesId", "name email")
    .populate("vendorId", "name")
    .populate("clientId", "name");
  if (!campaign) return notFound("Campaign not found");

  const user = await User.findById(auth.session.userId);
  if (!user) return notFound("User not found");

  const sales = campaign.salesId as unknown as { name: string; email: string };
  const vendor = campaign.vendorId as unknown as { name: string };
  const client = campaign.clientId as unknown as { name: string };

  try {
    await sendReminderEmail({
      fromName: user.name,
      fromEmail: user.email,
      appPassword: decryptSecret(user.appPassword),
      to: sales.email,
      salesName: sales.name,
      clientName: client.name,
      vendorName: vendor.name,
      city: campaign.city,
      type: campaign.type,
      location: campaign.location,
      endDate: new Date(campaign.endDate),
      daysLeft: Math.max(0, daysUntil(new Date(campaign.endDate))),
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
    });
  } catch (err) {
    return badRequest(
      err instanceof Error ? `Email failed: ${err.message}` : "Email failed",
    );
  }

  await Reminder.updateOne(
    { campaignId: campaign._id },
    { sent: true, sentAt: new Date() },
  );

  return ok({ ok: true, sentTo: sales.email });
}
