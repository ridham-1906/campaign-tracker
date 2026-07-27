// Shared attachment constants/validation — imported by both the upload route
// (server) and the upload dialog (client), so the two never drift. Plain
// module (no `server-only`) since the client side needs these too.

export const ATTACHMENT_KINDS = ["image", "document"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_STAGES = ["installation", "mid_date", "end_date"] as const;
export type AttachmentStage = (typeof ATTACHMENT_STAGES)[number];

export const PHOTO_TYPES = ["newspaper", "long_shot", "close_shot", "gps"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

export const PHOTO_TYPE_LABELS: Record<PhotoType, string> = {
  newspaper: "Newspaper",
  long_shot: "Long shot",
  close_shot: "Close shot",
  gps: "GPS",
};

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_MIME_TYPES = [
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
] as const;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024; // 30MB

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(",");
export const DOCUMENT_ACCEPT = DOCUMENT_MIME_TYPES.join(",");

export const STAGE_LABELS: Record<AttachmentStage, string> = {
  installation: "Installation",
  mid_date: "Mid date",
  end_date: "End date",
};

/** How attachments are bucketed for browsing: the three photo stages, plus decks. */
export type AttachmentType = AttachmentStage | "document";

export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  ...ATTACHMENT_STAGES,
  "document",
];

export const TYPE_LABELS: Record<AttachmentType, string> = {
  ...STAGE_LABELS,
  document: "Creative deck",
};

/** Per-type file tallies; a missing key means zero. */
export type AttachmentTypeCounts = Partial<Record<AttachmentType, number>>;

/** Documents and stage-less images both read as a creative deck. */
export function attachmentTypeOf(a: {
  kind: AttachmentKind;
  stage: AttachmentStage | null;
}): AttachmentType {
  return a.kind === "image" && a.stage ? a.stage : "document";
}

export function countByType(
  items: { kind: AttachmentKind; stage: AttachmentStage | null }[],
): AttachmentTypeCounts {
  const counts: AttachmentTypeCounts = {};
  for (const item of items) {
    const type = attachmentTypeOf(item);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Validate an uploaded file against the rules for its attachment kind. */
export function validateAttachmentFile(
  kind: "image" | "document",
  file: { type: string; size: number },
): string | null {
  const allowed: readonly string[] =
    kind === "image" ? IMAGE_MIME_TYPES : DOCUMENT_MIME_TYPES;
  const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;

  if (!allowed.includes(file.type)) {
    return `Unsupported file type: ${file.type || "unknown"}`;
  }
  if (file.size > max) {
    return `File too large (max ${Math.round(max / 1024 / 1024)}MB)`;
  }
  return null;
}
