import crypto from "crypto";

/**
 * Reversible encryption for sensitive secrets stored at rest (the per-user Gmail
 * app password). AES-256-GCM with a 32-byte key from ENCRYPTION_KEY.
 *
 * Format: `v1.<ivB64>.<authTagB64>.<cipherTextB64>`
 *
 * Not marked server-only so the seed script can reuse it; it only ever runs in
 * node contexts and never ships to the client.
 */

const PREFIX = "v1.";
const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  // Accept 64 hex chars (32 bytes) or a 32-char raw string.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "utf8");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes (64 hex chars, or a 32-character string)",
    );
  }
  return key;
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${authTag.toString(
    "base64",
  )}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  // Backward-compatible: values not written by encryptSecret are returned as-is
  // (e.g. legacy plaintext rows). Re-save them to encrypt.
  if (!isEncrypted(payload)) return payload;

  const [, ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted value");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
