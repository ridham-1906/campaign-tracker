import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import { hashPassword } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

// Node runtime (mongoose + bcrypt are not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  appPassword: z.string().min(1), // Gmail app password for nodemailer
});

const patchSchema = z
  .object({
    email: z.string().email(), // identifies the user to update
    newEmail: z.string().email().optional(), // must be a real Gmail/Workspace login
    name: z.string().min(1).optional(),
    password: z.string().min(6).optional(),
    appPassword: z.string().min(1).optional(),
  })
  .refine(
    (d) => d.newEmail || d.name || d.password || d.appPassword,
    { message: "Provide at least one field to update" },
  );

/** Shared REGISTER_SECRET check. Returns an error response or null if allowed. */
function checkSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.REGISTER_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "REGISTER_SECRET is not configured" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const provided = bearer ?? req.headers.get("x-register-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Admin-only user provisioning. There is no public signup — create the 2-3
 * backend users here from Postman:
 *
 *   POST /api/users
 *   Authorization: Bearer <REGISTER_SECRET>
 *   { "name": "...", "email": "...", "password": "...", "appPassword": "..." }
 */
export async function POST(req: NextRequest) {
  const denied = checkSecret(req);
  if (denied) return denied;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await connectDB();
  const email = parsed.data.email.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists" },
      { status: 409 },
    );
  }

  const user = await User.create({
    name: parsed.data.name,
    email,
    password: await hashPassword(parsed.data.password),
    appPassword: encryptSecret(parsed.data.appPassword),
  });

  return NextResponse.json(
    {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    },
    { status: 201 },
  );
}

/**
 * Admin-only user update (rotate an app password, change the sending Gmail,
 * reset a password, or rename). Identify the user by `email`; send any subset
 * of the updatable fields.
 *
 *   PATCH /api/users
 *   Authorization: Bearer <REGISTER_SECRET>
 *   { "email": "current@x.com", "appPassword": "new-app-password" }
 */
export async function PATCH(req: NextRequest) {
  const denied = checkSecret(req);
  if (denied) return denied;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = parsed.data;

  await connectDB();
  const user = await User.findOne({ email: d.email.toLowerCase() });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (d.newEmail) {
    const nextEmail = d.newEmail.toLowerCase();
    const taken = await User.findOne({ email: nextEmail });
    if (taken && taken._id.toString() !== user._id.toString()) {
      return NextResponse.json(
        { error: "That email is already in use" },
        { status: 409 },
      );
    }
    user.email = nextEmail;
  }
  if (d.name) user.name = d.name;
  if (d.password) user.password = await hashPassword(d.password);
  if (d.appPassword) user.appPassword = encryptSecret(d.appPassword);
  await user.save();

  return NextResponse.json({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
  });
}
