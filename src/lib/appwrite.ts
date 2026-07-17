import "server-only";
import { Client, Storage } from "node-appwrite";

// Checked lazily (inside getStorage/getBucketId), not at module load, so the
// app still builds and runs before Appwrite is provisioned — only actually
// uploading/viewing/deleting an attachment requires these to be set.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the environment`);
  return value;
}

export function getBucketId(): string {
  return requireEnv("APPWRITE_BUCKET_ID");
}

// Cache the client across hot reloads / serverless invocations, same as the
// Mongoose connection cache in lib/db.ts.
const globalForAppwrite = globalThis as unknown as { _appwriteStorage?: Storage };

export function getStorage(): Storage {
  if (globalForAppwrite._appwriteStorage) return globalForAppwrite._appwriteStorage;

  const client = new Client()
    .setEndpoint(requireEnv("APPWRITE_ENDPOINT"))
    .setProject(requireEnv("APPWRITE_PROJECT_ID"))
    .setKey(requireEnv("APPWRITE_API_KEY"));

  globalForAppwrite._appwriteStorage = new Storage(client);
  return globalForAppwrite._appwriteStorage;
}
