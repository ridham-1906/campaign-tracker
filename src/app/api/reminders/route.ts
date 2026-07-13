import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Campaign, Reminder } from "@/models";
import {
  authGuard,
  badRequest,
  created,
  ok,
  readJson,
  serializeReminder,
} from "@/lib/api";
import { isValidId } from "@/lib/services";
import { startOfDay } from "@/lib/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  campaignId: z.string().min(1),
  date: z.coerce.date(),
  sent: z.boolean().optional(),
});

export async function GET(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  await connectDB();
  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaignId");

  // Restrict to campaigns owned by the user.
  const owned = await Campaign.find({ userId: auth.session.userId })
    .select("_id")
    .lean();
  let ownedIds = owned.map((c) => c._id.toString());

  if (campaignId) {
    if (!ownedIds.includes(campaignId)) return ok([]);
    ownedIds = [campaignId];
  }

  const rows = await Reminder.find({ campaignId: { $in: ownedIds } })
    .sort({ date: 1 })
    .lean();
  return ok(rows.map(serializeReminder));
}

export async function POST(req: Request) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = createSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  if (!isValidId(parsed.data.campaignId)) return badRequest("Invalid campaignId");

  await connectDB();
  const owns = await Campaign.countDocuments({
    _id: parsed.data.campaignId,
    userId: auth.session.userId,
  });
  if (!owns) return badRequest("campaignId not found");

  const doc = await Reminder.create({
    campaignId: parsed.data.campaignId,
    date: startOfDay(parsed.data.date),
    sent: parsed.data.sent ?? false,
    sentAt: parsed.data.sent ? new Date() : null,
  });
  return created(serializeReminder(doc));
}
