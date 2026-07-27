// Plain, client-safe shapes returned by the read layer and the JSON API.
//
// Deliberately NOT `server-only`: these are the wire types, so client
// components import them directly instead of hand-maintaining mirrors that
// silently drift from the server's shape. `lib/data.ts` re-exports them.

import type { AttachmentKind, AttachmentStage, PhotoType } from "@/lib/attachments";

export type PersonView = { id: string; name: string; email?: string };

export type AttachmentView = {
  id: string;
  kind: AttachmentKind;
  stage: AttachmentStage | null;
  photoType: PhotoType | null;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string; // ISO
  /** Streams the file through our own auth-gated API — never a public Appwrite URL. */
  url: string;
};

export type LocationView = {
  id: string;
  city: string;
  location: string;
  type: string;
  days: number;
  status: string;
  vendor: PersonView;
  startDate: string; // ISO
  endDate: string; // ISO
  reminder: { date: string; sent: boolean; sentAt: string | null };
  attachments: AttachmentView[];
};

export type CampaignView = {
  id: string;
  client: PersonView;
  sales: PersonView;
  locations: LocationView[];
};

/**
 * A campaign as it appears in the paginated list. Attachments are omitted:
 * the campaigns table has no attachment column, and carrying them was roughly
 * half the payload. The detail endpoint (`GET /api/campaigns/:id`) still
 * returns the full `CampaignView`.
 */
export type CampaignListLocationView = Omit<LocationView, "attachments">;

export type CampaignListView = Omit<CampaignView, "locations"> & {
  locations: CampaignListLocationView[];
};

/** The six stat tiles above the campaigns table. */
export type CampaignStats = {
  total: number;
  live: number;
  expiring: number;
  ended: number;
  sentToday: number;
  creativePending: number;
};

export const CAMPAIGN_STATUS_FILTERS = [
  "all",
  "LIVE",
  "EXPIRING",
  "ENDED",
  "SENT_TODAY",
  "CREATIVE",
] as const;

export type CampaignStatusFilter = (typeof CAMPAIGN_STATUS_FILTERS)[number];

// ---- Reference entities ----

/** Bare option for comboboxes. */
export type OptionView = { id: string; name: string };

/** A reference entity plus how many campaigns use it. */
export type NamedCountView = { id: string; name: string; count: number };
export type SalesCountView = NamedCountView & { email: string };

// ---- Images ----

/**
 * One row per campaign that has at least one file — a summary, not a per-file
 * listing. Picking a location and a type is the preview dialog's job.
 */
export type CampaignImagesRowView = {
  /** The campaign id, which is also the row key. */
  id: string;
  clientName: string;
  locationCount: number;
  fileCount: number;
  latestUploadedAt: string; // ISO
};

// ---- Pagination envelope ----

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  limit: number;
};
