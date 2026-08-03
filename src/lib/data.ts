import "server-only";
import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, Client, ImageType, Sales, User, Vendor } from "@/models";
import {
  DEFAULT_REMINDER_LEAD_DAYS,
  addDays,
  businessToday,
} from "@/lib/campaign";
import { ATTACHMENT_STAGES, type AttachmentStage } from "@/lib/attachments";
import { type ListParams, searchRegex } from "@/lib/api";
import type {
  AttachmentView,
  CampaignImagesRowView,
  CampaignListLocationView,
  CampaignListView,
  CampaignStats,
  CampaignStatusFilter,
  CampaignView,
  ImageTypeOption,
  LocationView,
  NamedCountView,
  Page,
  PersonView,
  SalesCountView,
} from "@/lib/view-types";

// The view shapes live in a client-safe module so components can import them
// directly; re-exported here so existing server-side call sites don't change.
export type * from "@/lib/view-types";

/**
 * Mongoose casts filters in find()/countDocuments(), which is why passing a
 * string userId has always worked — but aggregation pipelines go to the driver
 * verbatim, where a string simply never matches an ObjectId. Every $match in
 * this file goes through here.
 */
function oid(id: string | Types.ObjectId) {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

// ---------------------------------------------------------------- time

/**
 * "Today" is computed in Node and injected as a literal. Mongo's $$NOW and
 * $dateTrunc are UTC, which drifts 5.5h from businessToday() — a campaign
 * ending today would be classified as ended for part of every evening.
 */
function dayWindow(now: Date = new Date()) {
  const today = businessToday(now);
  return {
    today,
    tomorrow: addDays(today, 1),
    soonEnd: addDays(today, DEFAULT_REMINDER_LEAD_DAYS),
  };
}

/**
 * The six stat-tile predicates, as plain query fragments.
 *
 * Start/end dates are stored at UTC midnight (see startOfDay in services.ts),
 * so each JS predicate in campaign.ts reduces to a range comparison — no
 * $expr, no date arithmetic, and the filters stay index-eligible.
 * `daysUntil(end) < 0` is exactly `endDate < today`.
 */
function statusFilters(now: Date = new Date()) {
  const { today, tomorrow, soonEnd } = dayWindow(now);

  // lifecycleState() checks PENDING_CREATIVE *before* the end-date test, so a
  // pending-creative location never becomes ENDED on its own.
  const LOC_LIVE = { status: "LIVE", endDate: { $gte: today } };
  const LOC_PENDING = { status: "PENDING_CREATIVE" };

  return {
    all: {},
    LIVE: { locations: { $elemMatch: LOC_LIVE } },
    EXPIRING: {
      locations: {
        $elemMatch: { status: "LIVE", endDate: { $gte: today, $lte: soonEnd } },
      },
    },
    /**
     * "Every location ended" is a universal, and $elemMatch is existential —
     * so it's expressed as "no location fails". The complement of ENDED is
     * PENDING_CREATIVE ∪ LIVE. The locations.0 clause reproduces the
     * `length > 0` guard for any legacy document the validator never saw.
     */
    ENDED: {
      "locations.0": { $exists: true },
      locations: { $not: { $elemMatch: { $or: [LOC_PENDING, LOC_LIVE] } } },
    },
    SENT_TODAY: {
      locations: { $elemMatch: { reminderSentAt: { $gte: today, $lt: tomorrow } } },
    },
    CREATIVE: {
      locations: {
        $elemMatch: { status: "PENDING_CREATIVE", endDate: { $gte: today } },
      },
    },
  } satisfies Record<CampaignStatusFilter, Record<string, unknown>>;
}

// ---------------------------------------------------------------- mappers

type LeanRef = { _id: unknown; name?: string; email?: string } | null | undefined;

function personFrom(ref: LeanRef): PersonView {
  if (!ref || typeof ref !== "object" || !("_id" in ref)) {
    return { id: "", name: "—" };
  }
  return { id: String(ref._id), name: ref.name ?? "—", email: ref.email };
}

type LeanAttachment = {
  _id: unknown;
  kind: string;
  stage?: string | null;
  imageTypeId?: unknown;
  photoType?: string | null;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt?: Date | null;
};

/**
 * `imageTypeById` resolves the id to a display name — pass a pre-built map for
 * a bulk read (see getCampaign), or omit it for a single doc that already has
 * the ImageType at hand (the upload/reclassify routes construct one inline).
 */
export function attachmentViewFrom(
  a: LeanAttachment,
  campaignId: string,
  locationId: string,
  imageTypeById?: Map<string, string>,
): AttachmentView {
  const imageTypeId = a.imageTypeId ? String(a.imageTypeId) : null;
  const imageTypeName = imageTypeId ? imageTypeById?.get(imageTypeId) : undefined;
  return {
    id: String(a._id),
    kind: a.kind as AttachmentView["kind"],
    stage: (a.stage ?? null) as AttachmentView["stage"],
    imageType:
      imageTypeId && imageTypeName ? { id: imageTypeId, name: imageTypeName } : null,
    photoType: (a.photoType ?? null) as AttachmentView["photoType"],
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    uploadedAt: new Date(a.uploadedAt ?? Date.now()).toISOString(),
    url: `/api/campaigns/${campaignId}/locations/${locationId}/attachments/${String(a._id)}`,
  };
}

// ---------------------------------------------------------------- image types

/** Every user starts with these three canonical stages already in place, so
 * the "type of image" picker never opens empty. `role` ties a seeded type
 * back to the fixed stage it represents (see models/image-type.ts) — a
 * custom type a user adds inline has none. */
const DEFAULT_IMAGE_TYPES: { name: string; role: AttachmentStage }[] = [
  { name: "Installation", role: "installation" },
  { name: "Mid date", role: "mid_date" },
  { name: "End date", role: "end_date" },
];

const STAGE_ORDER = new Map(ATTACHMENT_STAGES.map((s, i) => [s, i]));

/** Canonical stages first, in their fixed order, then custom types
 * alphabetically — matches how the picker has always looked. */
function sortImageTypes<T extends { name: string; role: AttachmentStage | null }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const ra = a.role ? (STAGE_ORDER.get(a.role) ?? ATTACHMENT_STAGES.length) : ATTACHMENT_STAGES.length;
    const rb = b.role ? (STAGE_ORDER.get(b.role) ?? ATTACHMENT_STAGES.length) : ATTACHMENT_STAGES.length;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });
}

/** The full list for a user's "type of image" picker, seeding the three
 * canonical stages the first time this user touches it. */
export async function getImageTypeOptions(userId: string): Promise<ImageTypeOption[]> {
  await connectDB();
  const existing = await ImageType.find({ userId }).lean();
  const rows =
    existing.length > 0
      ? existing
      : await ImageType.insertMany(DEFAULT_IMAGE_TYPES.map((t) => ({ ...t, userId })));
  return sortImageTypes(
    rows.map((t) => ({ id: String(t._id), name: t.name, role: t.role ?? null })),
  );
}

type LeanLocation = {
  _id: unknown;
  city: string;
  location: string;
  medium?: string;
  /** Pre-rename documents still carry the media format here — see mediumOf. */
  type?: string;
  width?: number | null;
  height?: number | null;
  sqft?: number | null;
  days: number;
  status: string;
  vendorId: unknown;
  startDate: Date;
  midDate?: Date | null;
  endDate: Date;
  reminderDate: Date;
  reminderSent: boolean;
  reminderSentAt?: Date | null;
};

/**
 * Split the two meanings `type` has had. Documents written before the rename
 * keep the media format in `type` and have no `medium` at all; for those the
 * illumination is simply unknown, and reading `type` straight through would
 * label a Billboard as its lighting. The migration clears this up permanently —
 * this only keeps un-migrated data readable in the meantime.
 */
function mediumOf(l: LeanLocation) {
  return l.medium
    ? { medium: l.medium, type: l.type ?? "" }
    : { medium: l.type ?? "", type: "" };
}

/** Vendors are resolved from a Map rather than a populate/$lookup — see getCampaignsPage. */
function locationFrom(
  l: LeanLocation,
  vendorById: Map<string, PersonView>,
): CampaignListLocationView {
  return {
    id: String(l._id),
    city: l.city,
    location: l.location,
    ...mediumOf(l),
    width: l.width ?? null,
    height: l.height ?? null,
    sqft: l.sqft ?? null,
    days: l.days,
    status: l.status,
    vendor: vendorById.get(String(l.vendorId)) ?? { id: "", name: "—" },
    startDate: new Date(l.startDate).toISOString(),
    midDate: l.midDate ? new Date(l.midDate).toISOString() : null,
    endDate: new Date(l.endDate).toISOString(),
    reminder: {
      date: new Date(l.reminderDate).toISOString(),
      sent: l.reminderSent,
      sentAt: l.reminderSentAt ? new Date(l.reminderSentAt).toISOString() : null,
    },
  };
}

/**
 * Resolve every vendor referenced by a page of campaigns, in one query.
 *
 * Vendors are a shared directory, so there is nothing to scope by — a vendorId
 * identifies exactly one vendor for every user.
 */
async function vendorMapFor(
  rows: { locations: LeanLocation[] }[],
): Promise<Map<string, PersonView>> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => (r.locations ?? []).map((l) => String(l.vendorId))),
    ),
  ];
  if (ids.length === 0) return new Map();

  const vendors = await Vendor.find({ _id: { $in: ids } })
    .select("name")
    .lean();
  return new Map(
    vendors.map((v) => [String(v._id), { id: String(v._id), name: v.name }]),
  );
}

// ---------------------------------------------------------------- options

/**
 * Clients, vendors and sales people are a shared directory — every user picks
 * from the same list, so none of these take a userId. See models/client.ts.
 */
export async function getSalesList(): Promise<PersonView[]> {
  await connectDB();
  const rows = await Sales.find().sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name, email: r.email }));
}

export async function getVendorList(): Promise<PersonView[]> {
  await connectDB();
  const rows = await Vendor.find().sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

export async function getClientList(): Promise<PersonView[]> {
  await connectDB();
  const rows = await Client.find().sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

/** Lightweight campaign picker for the add-images wizard. */
export async function getCampaignOptions(
  userId: string,
): Promise<{ id: string; clientName: string; locationCount: number }[]> {
  await connectDB();
  const rows = await Campaign.aggregate<{
    _id: Types.ObjectId;
    locationCount: number;
    client?: { name?: string };
  }>([
    { $match: { userId: oid(userId) } },
    { $project: { clientId: 1, locationCount: { $size: "$locations" } } },
    {
      $lookup: {
        from: Client.collection.name,
        localField: "clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    { $sort: { "client.name": 1, _id: 1 } },
  ]).exec();

  return rows.map((r) => ({
    id: String(r._id),
    clientName: r.client?.name ?? "—",
    locationCount: r.locationCount,
  }));
}

// ---------------------------------------------------------------- campaigns

export const CAMPAIGN_SORT_KEYS = ["endDate", "dates", "client"] as const;
export type CampaignSortKey = (typeof CAMPAIGN_SORT_KEYS)[number];

const CAMPAIGN_SORT_FIELDS: Record<CampaignSortKey, string> = {
  endDate: "earliestEnd",
  dates: "earliestStart",
  client: "client.name",
};

/**
 * Resolve the reference ids matching a search term, so the campaign pipeline
 * never has to join before paginating.
 *
 * Clients/Sales/Vendors are shared reference tables of tens to low hundreds of
 * rows, so three indexed name lookups are effectively free — and they let the
 * main $match stay a plain indexable query. The alternative ($lookup before
 * $match) would join every campaign of the user before filtering, and vendor
 * names would need the locations array unwound and reassembled.
 *
 * Resolving names globally doesn't widen the result: the ids only feed an $or
 * that still sits inside the caller's userId-scoped campaign filter.
 */
async function buildSearch(q: string) {
  const rx = searchRegex(q);
  const [clientIds, salesIds, vendorIds] = await Promise.all([
    Client.find({ name: rx }).limit(500).distinct("_id"),
    Sales.find({ name: rx }).limit(500).distinct("_id"),
    Vendor.find({ name: rx }).limit(500).distinct("_id"),
  ]);

  return {
    $or: [
      { clientId: { $in: clientIds } },
      { salesId: { $in: salesIds } },
      // Cross-element matching, which is already what the client-side filter
      // did — it joined every location into one searchable string.
      { "locations.location": rx },
      { "locations.city": rx },
      { "locations.medium": rx },
      { "locations.type": rx },
      { category: rx },
      { "locations.vendorId": { $in: vendorIds } },
    ],
  };
}

/** `userId: null` means "every user" — the admin all-users view. */
async function campaignFilter(
  userId: string | null,
  opts: { q?: string; status?: CampaignStatusFilter },
  now?: Date,
) {
  return {
    ...(userId ? { userId: oid(userId) } : {}),
    ...statusFilters(now)[opts.status ?? "all"],
    ...(opts.q ? await buildSearch(opts.q) : {}),
  };
}

/** Sinks malformed (location-less) campaigns instead of floating them to the top. */
const FAR_FUTURE = new Date(8.64e15);

/**
 * `userId: null` is the admin all-users view: every campaign regardless of
 * owner, with an extra `owner` lookup so the caller can tell whose is whose.
 * Writes never go through this path — create/edit/delete stay scoped to the
 * caller's own userId everywhere else, so this is read-only in effect.
 */
export async function getCampaignsPage(
  userId: string | null,
  params: ListParams<CampaignSortKey> & { status?: CampaignStatusFilter },
  now?: Date,
): Promise<Page<CampaignListView>> {
  await connectDB();

  const filter = await campaignFilter(
    userId,
    { q: params.q, status: params.status },
    now,
  );
  const sortField = CAMPAIGN_SORT_FIELDS[params.sort];

  const lookups: PipelineStage[] = [
    {
      $lookup: {
        from: Client.collection.name,
        localField: "clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    {
      $lookup: {
        from: Sales.collection.name,
        localField: "salesId",
        foreignField: "_id",
        as: "sales",
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    // A deleted client/sales must not drop the campaign — personFrom renders "—".
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$sales", preserveNullAndEmptyArrays: true } },
    ...(userId === null
      ? ([
          {
            $lookup: {
              from: User.collection.name,
              localField: "userId",
              foreignField: "_id",
              as: "owner",
              pipeline: [{ $project: { name: 1, email: 1 } }],
            },
          },
          { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
        ] as PipelineStage[])
      : []),
  ];

  // Sorting by client name is the one case that needs the join up front; every
  // other sort key is derived from the campaign's own locations, so the join
  // can wait until after $limit and run on a page's worth of rows.
  const sortsOnJoin = sortField.startsWith("client.");

  const pipeline: PipelineStage[] = [
    { $match: filter },
    {
      $addFields: {
        earliestEnd: { $ifNull: [{ $min: "$locations.endDate" }, FAR_FUTURE] },
        earliestStart: { $ifNull: [{ $min: "$locations.startDate" }, FAR_FUTURE] },
      },
    },
    ...(sortsOnJoin ? lookups : []),
    // The _id tiebreaker keeps the order total. Without it, campaigns sharing
    // an earliestEnd reorder between requests and skip-pagination duplicates
    // or drops rows across page boundaries.
    { $sort: { [sortField]: params.dir, _id: 1 } },
    { $skip: params.skip },
    { $limit: params.limit },
    ...(sortsOnJoin ? [] : lookups),
  ];

  type Row = {
    _id: Types.ObjectId;
    category?: string;
    locations: LeanLocation[];
    client?: LeanRef;
    sales?: LeanRef;
    owner?: LeanRef;
  };

  const [rows, total] = await Promise.all([
    Campaign.aggregate<Row>(pipeline).allowDiskUse(true).exec(),
    // Not a $facet branch: every clause of `filter` is on a raw stored field,
    // so this is a fully index-eligible count and cheaper than any pipeline.
    Campaign.countDocuments(filter),
  ]);

  const vendorById = await vendorMapFor(rows);

  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      client: personFrom(r.client),
      sales: personFrom(r.sales),
      category: r.category ?? "",
      ...(userId === null ? { owner: personFrom(r.owner) } : {}),
      locations: (r.locations ?? []).map((l) => locationFrom(l, vendorById)),
    })),
    total,
    page: params.page,
    limit: params.limit,
  };
}

/**
 * The stat tiles can't be derived from a page, so they get their own pass.
 * Takes the same `q` as the list (tiles reflect the search) but not the status
 * filter — the tiles *are* the status filter.
 */
export async function getCampaignStats(
  userId: string | null,
  opts: { q?: string } = {},
  now?: Date,
): Promise<CampaignStats> {
  await connectDB();

  const base = await campaignFilter(userId, { q: opts.q }, now);
  const f = statusFilters(now);
  const branch = (match: Record<string, unknown>) =>
    Object.keys(match).length === 0
      ? [{ $count: "n" }]
      : [{ $match: match }, { $count: "n" }];

  const [res] = await Campaign.aggregate<CampaignStats>([
    { $match: base },
    // $facet buffers its input and disables index use for every inner stage,
    // so shrink each document to the three scalar paths the predicates read.
    // Projecting nested array paths preserves the array shape, so $elemMatch
    // still works.
    {
      $project: {
        "locations.status": 1,
        "locations.endDate": 1,
        "locations.reminderSentAt": 1,
      },
    },
    {
      $facet: {
        total: branch(f.all),
        live: branch(f.LIVE),
        expiring: branch(f.EXPIRING),
        ended: branch(f.ENDED),
        sentToday: branch(f.SENT_TODAY),
        creativePending: branch(f.CREATIVE),
      },
    },
    // $count emits no document at all when the count is zero.
    {
      $replaceWith: {
        total: { $ifNull: [{ $first: "$total.n" }, 0] },
        live: { $ifNull: [{ $first: "$live.n" }, 0] },
        expiring: { $ifNull: [{ $first: "$expiring.n" }, 0] },
        ended: { $ifNull: [{ $first: "$ended.n" }, 0] },
        sentToday: { $ifNull: [{ $first: "$sentToday.n" }, 0] },
        creativePending: { $ifNull: [{ $first: "$creativePending.n" }, 0] },
      },
    },
  ]).exec();

  return (
    res ?? {
      total: 0,
      live: 0,
      expiring: 0,
      ended: 0,
      sentToday: 0,
      creativePending: 0,
    }
  );
}

/**
 * The full campaign, attachments included — the detail/edit view.
 *
 * `userId: null` is the admin all-users view — any campaign, regardless of
 * owner. The ImageType lookup always uses the campaign's own `r.userId`
 * (the type picker is per-owner), never the `userId` param, since the two
 * differ exactly in this admin case.
 */
export async function getCampaign(
  userId: string | null,
  id: string,
): Promise<CampaignView | null> {
  await connectDB();
  const r = await Campaign.findOne({ _id: id, ...(userId ? { userId } : {}) })
    .populate("salesId", "name email")
    .populate("clientId", "name")
    .populate("locations.vendorId", "name")
    .lean();
  if (!r) return null;

  const campaignId = r._id.toString();

  // Attachments are their own collection now, so they come back in one extra
  // query and get grouped onto their locations here. Image types are fetched
  // once (not per attachment) and resolved through a map, same shape as the
  // vendor lookup below.
  const [attachments, imageTypes] = await Promise.all([
    Attachment.find({ campaignId: r._id }).sort({ uploadedAt: 1 }).lean(),
    ImageType.find({ userId: r.userId }).lean(),
  ]);
  const imageTypeById = new Map(imageTypes.map((t) => [String(t._id), t.name]));
  const byLocation = new Map<string, AttachmentView[]>();
  for (const a of attachments) {
    const locationId = String(a.locationId);
    const list = byLocation.get(locationId) ?? [];
    list.push(attachmentViewFrom(a, campaignId, locationId, imageTypeById));
    byLocation.set(locationId, list);
  }

  const locations = (r.locations as unknown as LeanLocation[]).map(
    (l): LocationView => {
      const locationId = String(l._id);
      return {
        id: locationId,
        city: l.city,
        location: l.location,
        ...mediumOf(l),
        width: l.width ?? null,
        height: l.height ?? null,
        sqft: l.sqft ?? null,
        days: l.days,
        status: l.status,
        vendor: personFrom(l.vendorId as LeanRef),
        startDate: new Date(l.startDate).toISOString(),
        midDate: l.midDate ? new Date(l.midDate).toISOString() : null,
        endDate: new Date(l.endDate).toISOString(),
        reminder: {
          date: new Date(l.reminderDate).toISOString(),
          sent: l.reminderSent,
          sentAt: l.reminderSentAt
            ? new Date(l.reminderSentAt).toISOString()
            : null,
        },
        attachments: byLocation.get(locationId) ?? [],
      };
    },
  );

  return {
    id: campaignId,
    client: personFrom(r.clientId as LeanRef),
    sales: personFrom(r.salesId as LeanRef),
    category: r.category ?? "",
    locations,
  };
}

// ---------------------------------------------------- clients/vendors/sales

export const ENTITY_SORT_KEYS = ["name"] as const;
export type EntitySortKey = (typeof ENTITY_SORT_KEYS)[number];

/**
 * These three are a shared directory — the list is the same for every user, so
 * there is no owner filter here (see models/client.ts).
 *
 * `count` is deliberately absent from the sort keys. It's computed *after* the
 * page is chosen, so sorting by it would silently order by nothing — it needs
 * a campaign-rooted pipeline instead.
 */
function entityFilter(q?: string) {
  return q ? { name: searchRegex(q) } : {};
}

/**
 * Campaigns-per-entity, for just the ids on the current page.
 *
 * Counted across every user's campaigns, not just the viewer's: the number is
 * what blocks a delete, and a client still referenced by somebody else's
 * campaign must not look free to remove. Must agree with
 * countCampaignsUsing() in services.ts.
 */
async function countsByRef(
  field: "clientId" | "salesId",
  ids: Types.ObjectId[],
) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await Campaign.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]).exec();
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export async function getClientsPage(
  p: ListParams<EntitySortKey>,
): Promise<Page<NamedCountView>> {
  await connectDB();
  const filter = entityFilter(p.q);

  const [rows, total] = await Promise.all([
    Client.find(filter).sort({ name: p.dir, _id: 1 }).skip(p.skip).limit(p.limit).lean(),
    Client.countDocuments(filter),
  ]);

  const counts = await countsByRef("clientId", rows.map((r) => r._id));

  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      count: counts.get(String(r._id)) ?? 0,
    })),
    total,
    page: p.page,
    limit: p.limit,
  };
}

export async function getSalesPage(
  p: ListParams<EntitySortKey>,
): Promise<Page<SalesCountView>> {
  await connectDB();
  const filter = entityFilter(p.q);

  const [rows, total] = await Promise.all([
    Sales.find(filter).sort({ name: p.dir, _id: 1 }).skip(p.skip).limit(p.limit).lean(),
    Sales.countDocuments(filter),
  ]);

  const counts = await countsByRef("salesId", rows.map((r) => r._id));

  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      email: r.email,
      count: counts.get(String(r._id)) ?? 0,
    })),
    total,
    page: p.page,
    limit: p.limit,
  };
}

export async function getVendorsPage(
  p: ListParams<EntitySortKey>,
): Promise<Page<NamedCountView>> {
  await connectDB();
  const filter = entityFilter(p.q);

  const [rows, total] = await Promise.all([
    Vendor.find(filter).sort({ name: p.dir, _id: 1 }).skip(p.skip).limit(p.limit).lean(),
    Vendor.countDocuments(filter),
  ]);

  const ids = rows.map((r) => r._id);
  let counts = new Map<string, number>();
  if (ids.length > 0) {
    /**
     * Vendors sit on the locations, and a campaign must count once even if
     * several of its locations share the vendor. $setIntersection dedupes and
     * prunes to this page's ids in one step, so unwinding it emits exactly one
     * row per (campaign, vendor) — without ever expanding the full locations
     * array. Across every user's campaigns, for the reason in countsByRef().
     * Must agree with countCampaignsUsing() in services.ts.
     */
    const grouped = await Campaign.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { "locations.vendorId": { $in: ids } } },
      { $project: { v: { $setIntersection: ["$locations.vendorId", ids] } } },
      { $unwind: "$v" },
      { $group: { _id: "$v", n: { $sum: 1 } } },
    ]).exec();
    counts = new Map(grouped.map((r) => [String(r._id), r.n]));
  }

  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      name: r.name,
      count: counts.get(String(r._id)) ?? 0,
    })),
    total,
    page: p.page,
    limit: p.limit,
  };
}

// ---------------------------------------------------------------- images

export const IMAGE_SORT_KEYS = [
  "uploadedAt",
  "client",
  "locations",
  "count",
] as const;
export type ImageSortKey = (typeof IMAGE_SORT_KEYS)[number];

const IMAGE_SORT_FIELDS: Record<ImageSortKey, string> = {
  uploadedAt: "latestUploadedAt",
  client: "clientName",
  locations: "locationCount",
  count: "fileCount",
};

/**
 * One row per campaign that has at least one file.
 *
 * Grouping is a read shape, not a storage shape: attachments stay one document
 * per file, and the campaign row is assembled here. The row is a headline count
 * only — which locations and which types is the preview dialog's business.
 *
 * An attachment whose location was deleted still counts toward `fileCount`
 * while being invisible in the preview dialog — `npm run check:attachments`
 * exists to keep that at zero.
 */
/**
 * `userId: null` is the admin all-users view: every campaign with at least
 * one file, regardless of owner, plus an `owner` on each row.
 */
export async function getCampaignImagesPage(
  userId: string | null,
  p: ListParams<ImageSortKey>,
): Promise<Page<CampaignImagesRowView>> {
  await connectDB();

  const rx = p.q ? searchRegex(p.q) : null;

  const pipeline: PipelineStage[] = [
    // Covered by {userId, campaignId, uploadedAt}: the group never fetches a
    // document, since every field it touches is in the index.
    { $match: userId ? { userId: oid(userId) } : {} },
    {
      $group: {
        _id: "$campaignId",
        fileCount: { $sum: 1 },
        latestUploadedAt: { $max: "$uploadedAt" },
      },
    },
    // A plain equality join on _id, unlike the correlated $filter this replaced,
    // and it runs on one row per campaign rather than one per location.
    // `cities`/`locationNames` exist only to keep search working — neither is
    // returned.
    {
      $lookup: {
        from: Campaign.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "campaign",
        pipeline: [
          {
            $project: {
              clientId: 1,
              userId: 1,
              locationCount: { $size: "$locations" },
              cities: { $setUnion: ["$locations.city", []] },
              locationNames: { $setUnion: ["$locations.location", []] },
            },
          },
        ],
      },
    },
    { $unwind: { path: "$campaign", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: Client.collection.name,
        localField: "campaign.clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    ...(userId === null
      ? ([
          {
            $lookup: {
              from: User.collection.name,
              localField: "campaign.userId",
              foreignField: "_id",
              as: "owner",
              pipeline: [{ $project: { name: 1, email: 1 } }],
            },
          },
          { $unwind: { path: "$owner", preserveNullAndEmptyArrays: true } },
        ] as PipelineStage[])
      : []),
    {
      $addFields: {
        // "" rather than null: BSON sorts null before every string, which would
        // pin a client-less row to one end of every client-sorted page.
        clientName: { $ifNull: ["$client.name", ""] },
        locationCount: { $ifNull: ["$campaign.locationCount", 0] },
        cities: { $ifNull: ["$campaign.cities", []] },
        locationNames: { $ifNull: ["$campaign.locationNames", []] },
        ...(userId === null
          ? {
              ownerId: { $toString: "$owner._id" },
              ownerName: { $ifNull: ["$owner.name", "—"] },
              ownerEmail: "$owner.email",
            }
          : {}),
      },
    },
    // A regex against an array matches if any element does, so this one clause
    // still covers every city and location name on the campaign.
    ...(rx
      ? [
          {
            $match: {
              $or: [{ clientName: rx }, { cities: rx }, { locationNames: rx }],
            },
          } as PipelineStage,
        ]
      : []),
    // _id breaks ties: without a total order, $skip/$limit can repeat or drop
    // rows across pages.
    { $sort: { [IMAGE_SORT_FIELDS[p.sort]]: p.dir, _id: 1 } },
    // $facet is right here, unlike the campaign list: `total` is a post-$group
    // row count, which countDocuments() cannot produce.
    {
      $facet: {
        rows: [{ $skip: p.skip }, { $limit: p.limit }],
        total: [{ $count: "n" }],
      },
    },
  ];

  type Grouped = {
    _id: Types.ObjectId;
    fileCount: number;
    latestUploadedAt: Date;
    clientName: string;
    locationCount: number;
    ownerId?: string;
    ownerName?: string;
    ownerEmail?: string;
  };

  const [res] = await Attachment.aggregate<{
    rows: Grouped[];
    total: { n: number }[];
  }>(pipeline)
    .allowDiskUse(true)
    .exec();

  const rows = (res?.rows ?? []).map(
    (g): CampaignImagesRowView => ({
      id: String(g._id),
      clientName: g.clientName || "—",
      locationCount: g.locationCount,
      fileCount: g.fileCount,
      latestUploadedAt: new Date(g.latestUploadedAt).toISOString(),
      ...(userId === null
        ? { owner: { id: g.ownerId ?? "", name: g.ownerName ?? "—", email: g.ownerEmail } }
        : {}),
    }),
  );

  return {
    rows,
    total: res?.total?.[0]?.n ?? 0,
    page: p.page,
    limit: p.limit,
  };
}
