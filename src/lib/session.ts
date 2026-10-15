// Edge-safe session helpers (jose only, no node APIs). Safe to import in middleware.
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "campaign_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  name: string;
  email: string;
  /** Cross-user read visibility on the Dashboard/Campaigns/Images pages.
   * This claim is a snapshot from login only — getSession() in lib/auth.ts
   * re-reads the live value off the User document on every request, so this
   * field being stale in an old cookie never matters in practice. */
  isAdmin: boolean;
};

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      userId: payload.userId as string,
      name: payload.name as string,
      email: payload.email as string,
      isAdmin: payload.isAdmin === true,
    };
  } catch {
    return null;
  }
}
