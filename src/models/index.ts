import "server-only";

/**
 * Models are defined with the `models.X ?? model(...)` guard so they survive
 * Next.js hot reloads without "OverwriteModelError".
 *
 * Each model lives in its own file under src/models/ — this barrel re-exports
 * them all so existing `import { X } from "@/models"` call sites don't change.
 */

export * from "@/models/user";
export * from "@/models/sales";
export * from "@/models/vendor";
export * from "@/models/client";
export * from "@/models/campaign-location";
export * from "@/models/campaign";
