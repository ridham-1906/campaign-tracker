import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/models";
import {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  SessionPayload,
  signSessionToken,
  verifySessionToken,
} from "./session";

export type { SessionPayload };

/** Whether this email is listed in ADMIN_EMAILS — see SessionPayload.isAdmin. */
export function isAdminEmail(email: string) {
  const list = process.env.ADMIN_EMAILS ?? "";
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(payload: SessionPayload) {
  const token = await signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifySessionToken(token);
  if (!session) return null;

  // The signed cookie can outlive the user it points to (e.g. a reseeded
  // database) — treat that as logged out rather than letting requests act
  // on behalf of a nonexistent account. Cookies can only be cleared from a
  // Server Action or Route Handler, and this runs from plain Server
  // Component renders too, so just report "no session" here; the stale
  // cookie is harmless since this check keeps failing until a real login
  // overwrites it.
  await connectDB();
  const exists = await User.exists({ _id: session.userId });
  if (!exists) return null;

  return session;
}

/** Use in server components / actions that require a logged-in user. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
