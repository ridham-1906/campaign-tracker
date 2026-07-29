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

/** A photo-type filter, as offered by the PPT export picker — "all" is the
 * plain photo types plus one more option that matches any tagged photo. */
export const PHOTO_FILTERS = ["all", ...PHOTO_TYPES] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number];

export const PHOTO_FILTER_LABELS: Record<PhotoFilter, string> = {
  all: "All",
  ...PHOTO_TYPE_LABELS,
};

/** Whether an attachment matches a photo-type filter — "all" matches every
 * image regardless of whether it's been tagged with a photo type;
 * documents never match, and a specific filter only matches that exact tag. */
export function matchesPhotoFilter(
  attachment: { kind: AttachmentKind; photoType: PhotoType | null },
  filter: PhotoFilter,
): boolean {
  if (attachment.kind !== "image") return false;
  return filter === "all" || attachment.photoType === filter;
}

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

/** A stage filter, as offered by the PPT export picker — "all" is the three
 * install stages plus one more option that matches any of them. */
export const STAGE_FILTERS = ["all", ...ATTACHMENT_STAGES] as const;
export type StageFilter = (typeof STAGE_FILTERS)[number];

export const STAGE_FILTER_LABELS: Record<StageFilter, string> = {
  all: "All stages",
  ...STAGE_LABELS,
};

/** Whether an attachment matches a stage filter — "all" matches any image
 * regardless of its stage (or lack of one); documents never match. */
export function matchesStageFilter(
  attachment: { kind: AttachmentKind; stage: AttachmentStage | null },
  filter: StageFilter,
): boolean {
  if (attachment.kind !== "image") return false;
  return filter === "all" || attachment.stage === filter;
}

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
