import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Campaign } from "@/models";
import { authGuard, badRequest, notFound, ok, readJson } from "@/lib/api";
import { isValidId } from "@/lib/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** A deduped, sorted list of yyyy-mm-dd days, stored as UTC midnight. */
const dateList = z
  .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .max(100)
  .transform((a) => [...new Set(a)].sort().map((d) => new Date(`${d}T00:00:00.000Z`)))
  .refine((a) => a.every((d) => !Number.isNaN(d.getTime())), "Invalid date");

const bodySchema = z.object({
  installation: dateList,
  mid_date: dateList,
  end_date: dateList,
});

const toStrings = (dates?: Date[] | null) =>
  (dates ?? []).map((d) => new Date(d).toISOString().slice(0, 10));

/**
 * The campaign's vendor photo-request schedule: three date lists, one per
 * stage. On each date the hourly cron emails the campaign's vendors for that
 * stage's photo — see runScheduledVendorReminders in lib/reminders/vendor.ts.
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  await connectDB();
  const campaign = await Campaign.findOne(
    { _id: id, userId: auth.session.userId },
    { vendorReminderDates: 1 },
  ).lean();
  if (!campaign) return notFound("Campaign not found");

  const v = campaign.vendorReminderDates;
  return ok({
    installation: toStrings(v?.installation),
    mid_date: toStrings(v?.mid_date),
    end_date: toStrings(v?.end_date),
  });
}

export async function PUT(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!isValidId(id)) return notFound("Campaign not found");

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  await connectDB();
  const updated = await Campaign.findOneAndUpdate(
    { _id: id, userId: auth.session.userId },
    { $set: { vendorReminderDates: parsed.data } },
    { new: true, projection: { vendorReminderDates: 1 } },
  ).lean();
  if (!updated) return notFound("Campaign not found");

  const v = updated.vendorReminderDates;
  return ok({
    installation: toStrings(v?.installation),
    mid_date: toStrings(v?.mid_date),
    end_date: toStrings(v?.end_date),
  });
}
