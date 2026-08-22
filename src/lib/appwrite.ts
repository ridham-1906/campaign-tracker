import "server-only";
import { Client, Storage, Tokens, Users } from "node-appwrite";
import { SignJWT, jwtVerify } from "jose";
import type { AttachmentKind, PhotoType } from "@/lib/attachments";

// Checked lazily (inside the getters below), not at module load, so the app
// still builds and runs before Appwrite is provisioned — only actually
// uploading/viewing/deleting an attachment requires these to be set.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the environment`);
  return value;
}

export function getBucketId(): string {
  return requireEnv("APPWRITE_BUCKET_ID");
}

/** What the browser needs to talk to Appwrite itself. Handed out by the
 * upload-ticket route rather than published as NEXT_PUBLIC_* vars, so the
 * project stays free of build-time public config. */
export function getAppwriteConfig() {
  return {
    endpoint: requireEnv("APPWRITE_ENDPOINT"),
    projectId: requireEnv("APPWRITE_PROJECT_ID"),
    bucketId: requireEnv("APPWRITE_BUCKET_ID"),
  };
}

// Cache the clients across hot reloads / serverless invocations, same as the
// Mongoose connection cache in lib/db.ts.
const globalForAppwrite = globalThis as unknown as {
  _appwriteClient?: Client;
  _appwriteStorage?: Storage;
  _appwriteUsers?: Users;
  _appwriteTokens?: Tokens;
  _appwriteUploadSessionId?: string;
};

function getClient(): Client {
  globalForAppwrite._appwriteClient ??= new Client()
    .setEndpoint(requireEnv("APPWRITE_ENDPOINT"))
    .setProject(requireEnv("APPWRITE_PROJECT_ID"))
    .setKey(requireEnv("APPWRITE_API_KEY"));
  return globalForAppwrite._appwriteClient;
}

export function getStorage(): Storage {
  globalForAppwrite._appwriteStorage ??= new Storage(getClient());
  return globalForAppwrite._appwriteStorage;
}

export function getUsers(): Users {
  globalForAppwrite._appwriteUsers ??= new Users(getClient());
  return globalForAppwrite._appwriteUsers;
}

export function getTokens(): Tokens {
  globalForAppwrite._appwriteTokens ??= new Tokens(getClient());
  return globalForAppwrite._appwriteTokens;
}

// An hour, because the web SDK uploads large files in 5MB chunks and every
// chunk is authenticated with this — a short-lived JWT would expire mid-file
// on a slow connection.
const UPLOAD_JWT_SECONDS = 3600;
const VIEW_TOKEN_SECONDS = 3600;

/**
 * A short-lived Appwrite credential for the browser, so file bytes go straight
 * to Appwrite instead of through us (Vercel caps a function's request body at
 * ~4.5MB, well under our own file limits).
 *
 * It impersonates one dedicated Appwrite user whose only bucket grant is
 * `create`: a leaked JWT can add a file, never list, read or delete one. The
 * admin API key stays server-side and still does everything else.
 */
export async function mintUploadJwt(): Promise<{ jwt: string; expiresAt: string }> {
  const userId = requireEnv("APPWRITE_UPLOAD_USER_ID");
  const users = getUsers();

  let sessionId = globalForAppwrite._appwriteUploadSessionId;
  let token;
  try {
    if (!sessionId) throw new Error("no cached session");
    token = await users.createJWT({ userId, sessionId, duration: UPLOAD_JWT_SECONDS });
  } catch {
    // Appwrite evicts a user's oldest sessions past its per-user cap, so a
    // cached id can go stale between cold starts. Make a fresh one and retry
    // once — which also covers the very first call on a new deployment.
    const session = await users.createSession({ userId });
    globalForAppwrite._appwriteUploadSessionId = session.$id;
    sessionId = session.$id;
    token = await users.createJWT({ userId, sessionId, duration: UPLOAD_JWT_SECONDS });
  }

  return {
    jwt: token.jwt,
    expiresAt: new Date(Date.now() + UPLOAD_JWT_SECONDS * 1000).toISOString(),
  };
}

/**
 * A tokenised Appwrite URL the browser can read directly. Our own routes still
 * do the access check and then redirect here, so the bytes never pass through a
 * function — Vercel caps response bodies at ~4.5MB too.
 *
 * `seconds` is how long the minted URL keeps working once handed out, which is
 * also how long it outlives a revoked share — so the public preview route asks
 * for a much shorter one than the session-gated gallery.
 */
export async function createFileViewUrl(
  fileId: string,
  seconds: number = VIEW_TOKEN_SECONDS,
): Promise<string> {
  const { endpoint, projectId, bucketId } = getAppwriteConfig();
  const token = await getTokens().createFileToken({
    bucketId,
    fileId,
    expire: new Date(Date.now() + seconds * 1000).toISOString(),
  });

  const query = new URLSearchParams({ project: projectId, token: token.secret });
  return `${endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?${query}`;
}

/**
 * What the upload-ticket route promised and the register route must honour.
 * The file ids are chosen server-side and signed in here, so a client can only
 * ever register a blob it was just authorised to upload — never one it guessed
 * or scraped.
 */
export type UploadTicket = {
  userId: string;
  campaignId: string;
  locationId: string;
  kind: AttachmentKind;
  imageTypeId?: string;
  photoType?: PhotoType;
  fileIds: string[];
};

// Signed with JWT_SECRET like the session cookie, so the audience claim is what
// keeps a stolen session token from being replayed as an upload ticket.
const TICKET_AUDIENCE = "attachment-upload";
const TICKET_MAX_AGE = "1h";

function ticketSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signUploadTicket(ticket: UploadTicket): Promise<string> {
  return new SignJWT({ ...ticket })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(TICKET_AUDIENCE)
    .setExpirationTime(TICKET_MAX_AGE)
    .sign(ticketSecret());
}

export async function verifyUploadTicket(token: string): Promise<UploadTicket | null> {
  try {
    const { payload } = await jwtVerify(token, ticketSecret(), {
      audience: TICKET_AUDIENCE,
    });
    const fileIds = payload.fileIds;
    if (!Array.isArray(fileIds) || !fileIds.every((f) => typeof f === "string")) {
      return null;
    }
    return {
      userId: payload.userId as string,
      campaignId: payload.campaignId as string,
      locationId: payload.locationId as string,
      kind: payload.kind as AttachmentKind,
      imageTypeId: payload.imageTypeId as string | undefined,
      photoType: payload.photoType as PhotoType | undefined,
      fileIds,
    };
  } catch {
    return null;
  }
}
