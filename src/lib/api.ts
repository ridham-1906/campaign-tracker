import "server-only";
import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth";

// ---- JSON response helpers ----
export const ok = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export const created = (data: unknown) => NextResponse.json(data, { status: 201 });

export const badRequest = (error: string, issues?: unknown) =>
  NextResponse.json(issues ? { error, issues } : { error }, { status: 400 });

export const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export const notFound = (error = "Not found") =>
  NextResponse.json({ error }, { status: 404 });

export const conflict = (error: string) =>
  NextResponse.json({ error }, { status: 409 });

/** Read+auth guard for API routes. Returns the session or a 401 response. */
export async function authGuard(): Promise<
  { session: SessionPayload } | { error: NextResponse }
> {
  const session = await getSession();
  if (!session) return { error: unauthorized() };
  return { session };
}

/** Parse a JSON body, returning a 400 response on malformed input. */
export async function readJson(
  req: Request,
): Promise<{ data: unknown } | { error: NextResponse }> {
  try {
    return { data: await req.json() };
  } catch {
    return { error: badRequest("Invalid JSON body") };
  }
}

// ---- Serializers (Mongoose lean docs -> plain JSON) ----
type Id = { toString(): string };

export function serializeSales(d: {
  _id: Id;
  name: string;
  email: string;
  createdAt?: Date;
}) {
  return {
    id: d._id.toString(),
    name: d.name,
    email: d.email,
    createdAt: d.createdAt,
  };
}

export function serializeNamed(d: { _id: Id; name: string; createdAt?: Date }) {
  return { id: d._id.toString(), name: d.name, createdAt: d.createdAt };
}

export function serializeReminder(d: {
  _id: Id;
  campaignId: Id;
  date: Date;
  sent: boolean;
  sentAt?: Date | null;
}) {
  return {
    id: d._id.toString(),
    campaignId: d.campaignId.toString(),
    date: d.date,
    sent: d.sent,
    sentAt: d.sentAt ?? null,
  };
}

export function serializeCampaign(d: {
  _id: Id;
  city: string;
  type: string;
  location: string;
  days: number;
  status: string;
  startDate: Date;
  endDate: Date;
  salesId: Id;
  vendorId: Id;
  clientId: Id;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: d._id.toString(),
    city: d.city,
    type: d.type,
    location: d.location,
    days: d.days,
    status: d.status,
    startDate: d.startDate,
    endDate: d.endDate,
    salesId: d.salesId.toString(),
    vendorId: d.vendorId.toString(),
    clientId: d.clientId.toString(),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
