import { z } from "zod";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Campaign, User } from "@/models";
import { sendMail } from "@/lib/mailer";
import { buildExpiryReminder } from "@/lib/mail/expiry-reminder";
import { decryptSecret } from "@/lib/crypto";
import {
  addDays,
  daysUntil,
  lifecycleState,
  reminderScheduleFor,
} from "@/lib/campaign";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";
import { isValidId } from "@/lib/services";
import { sendVendorRemindersNow } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ locationId: z.string().min(1).optional() });

type LocationLike = {
  _id: unknown;
  vendorId: Types.ObjectId;
  city: string;
  location: string;
  medium?: string;
  /** Pre-rename documents keep the media format here. */
  type?: string;
  status: string;
  startDate: Date;
  endDate: Date;
  reminderDate: Date;
  reminderSent: boolean;
  reminderSentAt?: Date | null;
};

/**
 * Immediately email the campaign's sales person. With `locationId`, nudges about
 * that one placement; without it, sends a single digest covering every location
 * that hasn't ended yet.
 *
 * Each vendor with an email on those locations is then sent its own vendor
 * reminder about just its sites. A vendor failure doesn't fail the request —
 * the sales email has already gone — it comes back in `vendorErrors`.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = bodySchema.safeParse(body.data ?? {});
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);
  const { locationId } = parsed.data;

  await connectDB();
  const campaign = await Campaign.findOne({
    _id: id,
    userId: auth.session.userId,
  })
    .populate("salesId", "name email")
    .populate("clientId", "name");
  if (!campaign) return notFound("Campaign not found");

  const user = await User.findById(auth.session.userId);
  if (!user) return notFound("User not found");
  if (!user.appPassword?.trim()) {
    return badRequest("No Gmail app password configured for this account");
  }

  const sales = campaign.salesId as unknown as { name: string; email: string };
  const client = campaign.clientId as unknown as { name: string };
  const all = campaign.locations as unknown as LocationLike[];

  const targets = locationId
    ? all.filter((l) => String(l._id) === locationId)
    : all.filter(
        (l) =>
          lifecycleState({ status: l.status, endDate: new Date(l.endDate) }) !==
          "ENDED",
      );

  if (targets.length === 0) {
    return badRequest(
      locationId ? "Location not found" : "No live locations to remind about",
    );
  }

  const appPassword = decryptSecret(user.appPassword);

  try {
    await sendMail({
      fromName: user.name,
      fromEmail: user.email,
      appPassword,
      to: sales.email,
      message: buildExpiryReminder({
        fromName: user.name,
        salesName: sales.name,
        clientName: client.name,
        locations: targets.map((l) => ({
          location: l.location,
          city: l.city,
          medium: l.medium ?? l.type ?? "",
          endDate: new Date(l.endDate),
          daysLeft: Math.max(0, daysUntil(new Date(l.endDate))),
        })),
      }),
    });
  } catch (err) {
    return badRequest(
      err instanceof Error ? `Email failed: ${err.message}` : "Email failed",
    );
  }

  // Advance exactly the locations this email covered, so the automated series
  // doesn't fire again for them today.
  const sentAt = new Date();
  const from = addDays(new Date(), 1);
  for (const l of targets) {
    Object.assign(l, reminderScheduleFor(new Date(l.endDate), from));
    l.reminderSentAt = sentAt;
  }
  await campaign.save();

  const vendors = await sendVendorRemindersNow({
    owner: { _id: user._id, name: user.name, email: user.email, appPassword },
    campaignId: campaign._id,
    clientName: client.name,
    locations: targets.map((l) => ({
      vendorId: l.vendorId,
      city: l.city,
      location: l.location,
      medium: l.medium ?? l.type ?? "",
      status: l.status,
      startDate: l.startDate,
      endDate: l.endDate,
    })),
  });

  return ok({
    ok: true,
    sentTo: sales.email,
    locations: targets.length,
    vendorsSentTo: vendors.sentTo,
    vendorErrors: vendors.errors,
  });
}
