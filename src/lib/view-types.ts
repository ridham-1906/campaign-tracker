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
  /** The user-managed image type this photo was tagged with — null for
   * documents, and for images uploaded before this field existed. */
  imageType: { id: string; name: string } | null;
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
  /** Media format — Billboard, Gantry, LED… */
  medium: string;
  /** Illumination — "Lit" / "Nonlit". `""` when never filled in. */
  type: string;
  /** Site dimensions in feet; null when never filled in. */
  width: number | null;
  height: number | null;
  sqft: number | null;
  days: number;
  status: string;
  vendor: PersonView;
  startDate: string; // ISO
  midDate: string | null; // ISO, optional
  endDate: string; // ISO
  reminder: { date: string; sent: boolean; sentAt: string | null };
  attachments: AttachmentView[];
};

export type CampaignView = {
  id: string;
  client: PersonView;
  sales: PersonView;
  /** Campaign-wide classification. `""` when never filled in. */
  category: string;
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
  /** Only present when an admin account is viewing every user's campaigns —
   * absent for a normal, single-user query. */
  owner?: PersonView;
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

/** One "type of image" option — `role` ties a seeded type back to the fixed
 * lifecycle stage it represents (installation/mid_date/end_date); a custom
 * type a user adds inline has none. */
export type ImageTypeOption = { id: string; name: string; role: AttachmentStage | null };

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
  /** Only present when an admin account is viewing every user's images. */
  owner?: PersonView;
};

// ---- Shared preview link ----

/**
 * The subset of a location the gallery and the deck builder actually read.
 * `LocationView` satisfies it, so nothing at the existing call sites changes —
 * it exists so the public share payload can leave out the internal vendor,
 * status and reminder bookkeeping and still feed the same components.
 */
export type LocationPreview = Pick<
  LocationView,
  | "id"
  | "city"
  | "location"
  | "medium"
  | "type"
  | "width"
  | "height"
  | "sqft"
  | "startDate"
  | "midDate"
  | "endDate"
  | "attachments"
>;

/**
 * What a never-expiring preview link resolves to. No emails, no vendors, no
 * reminder state: whoever holds the token is outside the app, so this carries
 * only what the preview page renders.
 */
export type SharePreviewView = {
  token: string;
  clientName: string;
  /** The user who shared it, for the "shared by" line. */
  sharedBy: string;
  createdAt: string; // ISO
  fileCount: number;
  locations: LocationPreview[];
};

/** What POST /api/campaigns/:id/share answers with. */
export type ShareSendResult = {
  ok: true;
  /** Absolute, never-expiring preview URL. */
  url: string;
  sentTo: string;
  fileCount: number;
};

// ---- Pagination envelope ----

export type Page<T> = {
  rows: T[];
  total: number;
  page: number;
  limit: number;
};
