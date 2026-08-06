// Edge-safe session helpers (jose only, no node APIs). Safe to import in middleware.
import { SignJWT, jwtVerify } from "jose";

export const COOKIE_NAME = "campaign_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: string;
  name: string;
  email: string;
  /** Whether this account is listed in ADMIN_EMAILS — grants cross-user
   * read visibility on the Campaigns/Images pages. Computed once at login,
   * not re-derived per request, so changing ADMIN_EMAILS takes effect on the
   * next login rather than the next request. */
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
