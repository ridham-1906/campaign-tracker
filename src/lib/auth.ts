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
  //
  // `isAdmin` is read fresh from this same lookup rather than trusted from
  // the JWT: it's a live flag on the User document (see models/user.ts), so
  // flipping it takes effect on the very next request — no stale cookie to
  // wait out, unlike the old ADMIN_EMAILS-at-login design this replaced.
  await connectDB();
  const user = await User.findById(session.userId, { isAdmin: 1 });
  if (!user) return null;

  return { ...session, isAdmin: user.isAdmin === true };
}

/** Use in server components / actions that require a logged-in user. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
