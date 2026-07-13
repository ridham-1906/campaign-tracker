import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Campaign, Reminder } from "@/models";
import {
  authGuard,
  badRequest,
  notFound,
  ok,
  readJson,
  serializeReminder,
} from "@/lib/api";
import { isValidId } from "@/lib/services";
import { startOfDay } from "@/lib/campaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    date: z.coerce.date().optional(),
    sent: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "No fields to update" });

type Params = { params: Promise<{ id: string }> };

/** Load a reminder only if its campaign belongs to the user. */
async function ownedReminder(userId: string, id: string) {
  if (!isValidId(id)) return null;
  await connectDB();
  const reminder = await Reminder.findById(id);
  if (!reminder) return null;
  const owns = await Campaign.countDocuments({
    _id: reminder.campaignId,
    userId,
  });
  return owns ? reminder : null;
}

export async function GET(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const reminder = await ownedReminder(auth.session.userId, id);
  if (!reminder) return notFound("Reminder not found");
  return ok(serializeReminder(reminder));
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const body = await readJson(req);
  if ("error" in body) return body.error;
  const parsed = updateSchema.safeParse(body.data);
  if (!parsed.success) return badRequest("Validation failed", parsed.error.issues);

  const reminder = await ownedReminder(auth.session.userId, id);
  if (!reminder) return notFound("Reminder not found");

  if (parsed.data.date !== undefined) {
    reminder.date = startOfDay(parsed.data.date);
  }
  if (parsed.data.sent !== undefined) {
    reminder.sent = parsed.data.sent;
    reminder.sentAt = parsed.data.sent ? new Date() : null;
  }
  await reminder.save();
  return ok(serializeReminder(reminder));
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await authGuard();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const reminder = await ownedReminder(auth.session.userId, id);
  if (!reminder) return notFound("Reminder not found");
  await reminder.deleteOne();
  return ok({ ok: true, id });
}
