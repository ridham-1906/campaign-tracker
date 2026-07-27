import "server-only";
import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { Attachment, Campaign, Client, Sales, Vendor } from "@/models";
import {
  DEFAULT_REMINDER_LEAD_DAYS,
  addDays,
  businessToday,
} from "@/lib/campaign";
import { type ListParams, searchRegex } from "@/lib/api";
import type {
  AttachmentView,
  CampaignImagesRowView,
  CampaignListLocationView,
  CampaignListView,
  CampaignStats,
  CampaignStatusFilter,
  CampaignView,
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
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt?: Date | null;
};

export function attachmentViewFrom(
  a: LeanAttachment,
  campaignId: string,
  locationId: string,
): AttachmentView {
  return {
    id: String(a._id),
    kind: a.kind as AttachmentView["kind"],
    stage: (a.stage ?? null) as AttachmentView["stage"],
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    uploadedAt: new Date(a.uploadedAt ?? Date.now()).toISOString(),
    url: `/api/campaigns/${campaignId}/locations/${locationId}/attachments/${String(a._id)}`,
  };
}

type LeanLocation = {
  _id: unknown;
  city: string;
  location: string;
  type: string;
  days: number;
  status: string;
  vendorId: unknown;
  startDate: Date;
  endDate: Date;
  reminderDate: Date;
  reminderSent: boolean;
  reminderSentAt?: Date | null;
};

/** Vendors are resolved from a Map rather than a populate/$lookup — see getCampaignsPage. */
function locationFrom(
  l: LeanLocation,
  vendorById: Map<string, PersonView>,
): CampaignListLocationView {
  return {
    id: String(l._id),
    city: l.city,
    location: l.location,
    type: l.type,
    days: l.days,
    status: l.status,
    vendor: vendorById.get(String(l.vendorId)) ?? { id: "", name: "—" },
    startDate: new Date(l.startDate).toISOString(),
    endDate: new Date(l.endDate).toISOString(),
    reminder: {
      date: new Date(l.reminderDate).toISOString(),
      sent: l.reminderSent,
      sentAt: l.reminderSentAt ? new Date(l.reminderSentAt).toISOString() : null,
    },
  };
}

/** Resolve every vendor referenced by a page of campaigns, in one query. */
async function vendorMapFor(
  userId: string,
  rows: { locations: LeanLocation[] }[],
): Promise<Map<string, PersonView>> {
  const ids = [
    ...new Set(
      rows.flatMap((r) => (r.locations ?? []).map((l) => String(l.vendorId))),
    ),
  ];
  if (ids.length === 0) return new Map();

  // Scoped by userId, which re-applies the ownership check .populate() never did.
  const vendors = await Vendor.find({ _id: { $in: ids }, userId })
    .select("name")
    .lean();
  return new Map(
    vendors.map((v) => [String(v._id), { id: String(v._id), name: v.name }]),
  );
}

// ---------------------------------------------------------------- options

export async function getSalesList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Sales.find({ userId }).sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name, email: r.email }));
}

export async function getVendorList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Vendor.find({ userId }).sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: r._id.toString(), name: r.name }));
}

export async function getClientList(userId: string): Promise<PersonView[]> {
  await connectDB();
  const rows = await Client.find({ userId }).sort({ name: 1 }).lean();
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
 * Clients/Sales/Vendors are per-user reference tables of tens to low hundreds
 * of rows, so three indexed {userId, name} lookups are effectively free — and
 * they let the main $match stay a plain indexable query. The alternative
 * ($lookup before $match) would join every campaign of the user before
 * filtering, and vendor names would need the locations array unwound and
 * reassembled.
 */
async function buildSearch(userId: string, q: string) {
  const rx = searchRegex(q);
  const [clientIds, salesIds, vendorIds] = await Promise.all([
    Client.find({ userId, name: rx }).limit(500).distinct("_id"),
    Sales.find({ userId, name: rx }).limit(500).distinct("_id"),
    Vendor.find({ userId, name: rx }).limit(500).distinct("_id"),
  ]);

  return {
    $or: [
      { clientId: { $in: clientIds } },
      { salesId: { $in: salesIds } },
      // Cross-element matching, which is already what the client-side filter
      // did — it joined every location into one searchable string.
      { "locations.location": rx },
      { "locations.city": rx },
      { "locations.type": rx },
      { "locations.vendorId": { $in: vendorIds } },
    ],
  };
}

async function campaignFilter(
  userId: string,
  opts: { q?: string; status?: CampaignStatusFilter },
  now?: Date,
) {
  return {
    userId: oid(userId),
    ...statusFilters(now)[opts.status ?? "all"],
    ...(opts.q ? await buildSearch(userId, opts.q) : {}),
  };
}

/** Sinks malformed (location-less) campaigns instead of floating them to the top. */
const FAR_FUTURE = new Date(8.64e15);

export async function getCampaignsPage(
  userId: string,
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
    locations: LeanLocation[];
    client?: LeanRef;
    sales?: LeanRef;
  };

  const [rows, total] = await Promise.all([
    Campaign.aggregate<Row>(pipeline).allowDiskUse(true).exec(),
    // Not a $facet branch: every clause of `filter` is on a raw stored field,
    // so this is a fully index-eligible count and cheaper than any pipeline.
    Campaign.countDocuments(filter),
  ]);

  const vendorById = await vendorMapFor(userId, rows);

  return {
    rows: rows.map((r) => ({
      id: String(r._id),
      client: personFrom(r.client),
      sales: personFrom(r.sales),
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
  userId: string,
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

/** The full campaign, attachments included — the detail/edit view. */
export async function getCampaign(
  userId: string,
  id: string,
): Promise<CampaignView | null> {
  await connectDB();
  const r = await Campaign.findOne({ _id: id, userId })
    .populate("salesId", "name email")
    .populate("clientId", "name")
    .populate("locations.vendorId", "name")
    .lean();
  if (!r) return null;

  const campaignId = r._id.toString();

  // Attachments are their own collection now, so they come back in one extra
  // query and get grouped onto their locations here.
  const attachments = await Attachment.find({ campaignId: r._id })
    .sort({ uploadedAt: 1 })
    .lean();
  const byLocation = new Map<string, AttachmentView[]>();
  for (const a of attachments) {
    const locationId = String(a.locationId);
    const list = byLocation.get(locationId) ?? [];
    list.push(attachmentViewFrom(a, campaignId, locationId));
    byLocation.set(locationId, list);
  }

  const locations = (r.locations as unknown as LeanLocation[]).map(
    (l): LocationView => {
      const locationId = String(l._id);
      return {
        id: locationId,
        city: l.city,
        location: l.location,
        type: l.type,
        days: l.days,
        status: l.status,
        vendor: personFrom(l.vendorId as LeanRef),
        startDate: new Date(l.startDate).toISOString(),
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
    locations,
  };
}

// ---------------------------------------------------- clients/vendors/sales

export const ENTITY_SORT_KEYS = ["name"] as const;
export type EntitySortKey = (typeof ENTITY_SORT_KEYS)[number];

/**
 * `count` is deliberately absent from the sort keys. It's computed *after* the
 * page is chosen, so sorting by it would silently order by nothing — it needs
 * a campaign-rooted pipeline instead.
 */
function entityFilter(userId: string, q?: string) {
  return { userId, ...(q ? { name: searchRegex(q) } : {}) };
}

/** Campaigns-per-entity, for just the ids on the current page. */
async function countsByRef(
  userId: string,
  field: "clientId" | "salesId",
  ids: Types.ObjectId[],
) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await Campaign.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { userId: oid(userId), [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ]).exec();
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

export async function getClientsPage(
  userId: string,
  p: ListParams<EntitySortKey>,
): Promise<Page<NamedCountView>> {
  await connectDB();
  const filter = entityFilter(userId, p.q);

  const [rows, total] = await Promise.all([
    Client.find(filter).sort({ name: p.dir, _id: 1 }).skip(p.skip).limit(p.limit).lean(),
    Client.countDocuments(filter),
  ]);

  const counts = await countsByRef(userId, "clientId", rows.map((r) => r._id));

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
  userId: string,
  p: ListParams<EntitySortKey>,
): Promise<Page<SalesCountView>> {
  await connectDB();
  const filter = entityFilter(userId, p.q);

  const [rows, total] = await Promise.all([
    Sales.find(filter).sort({ name: p.dir, _id: 1 }).skip(p.skip).limit(p.limit).lean(),
    Sales.countDocuments(filter),
  ]);

  const counts = await countsByRef(userId, "salesId", rows.map((r) => r._id));

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
  userId: string,
  p: ListParams<EntitySortKey>,
): Promise<Page<NamedCountView>> {
  await connectDB();
  const filter = entityFilter(userId, p.q);

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
     * array. Must agree with countCampaignsUsing() in services.ts.
     */
    const grouped = await Campaign.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: oid(userId), "locations.vendorId": { $in: ids } } },
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
export async function getCampaignImagesPage(
  userId: string,
  p: ListParams<ImageSortKey>,
): Promise<Page<CampaignImagesRowView>> {
  await connectDB();

  const rx = p.q ? searchRegex(p.q) : null;

  const pipeline: PipelineStage[] = [
    // Covered by {userId, campaignId, uploadedAt}: the group never fetches a
    // document, since every field it touches is in the index.
    { $match: { userId: oid(userId) } },
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
    {
      $addFields: {
        // "" rather than null: BSON sorts null before every string, which would
        // pin a client-less row to one end of every client-sorted page.
        clientName: { $ifNull: ["$client.name", ""] },
        locationCount: { $ifNull: ["$campaign.locationCount", 0] },
        cities: { $ifNull: ["$campaign.cities", []] },
        locationNames: { $ifNull: ["$campaign.locationNames", []] },
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
    }),
  );

  return {
    rows,
    total: res?.total?.[0]?.n ?? 0,
    page: p.page,
    limit: p.limit,
  };
}
