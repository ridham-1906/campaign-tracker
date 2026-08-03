/**
 * Hierarchical query keys. invalidateQueries() matches by prefix, so
 * invalidating `entityKeys.all("clients")` clears both the management list
 * (with usage counts) and the combobox options list — two different shapes of
 * the same resource that must never drift apart.
 */

/** Everything a list screen puts into its key. */
export type ListKeyParams = {
  page?: number;
  limit?: number;
  sort?: string;
  dir?: "asc" | "desc";
  q?: string;
  status?: string;
};

/** The three reference resources that share the form/combobox machinery. */
export const ENTITY_KINDS = ["clients", "vendors", "sales"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Parameterised by `kind` rather than nested under it, so components generic
 * over the resource can build a key without string concatenation — and so the
 * kind is visibly part of the key expression at each call site.
 */
export const entityKeys = {
  all: (kind: EntityKind) => [kind] as const,
  lists: (kind: EntityKind) => [kind, "list"] as const,
  list: (kind: EntityKind, params: ListKeyParams = {}) =>
    [kind, "list", params] as const,
  /** Bare {id,name} for the comboboxes — no usage counts. */
  options: (kind: EntityKind) => [kind, "options"] as const,
};

export const queryKeys = {
  campaigns: {
    all: ["campaigns"] as const,
    lists: () => [...queryKeys.campaigns.all, "list"] as const,
    list: (params: ListKeyParams = {}) =>
      [...queryKeys.campaigns.lists(), params] as const,
    stats: (params: Pick<ListKeyParams, "q"> = {}) =>
      [...queryKeys.campaigns.all, "stats", params] as const,
    detail: (id: string) => [...queryKeys.campaigns.all, "detail", id] as const,
    options: () => [...queryKeys.campaigns.all, "options"] as const,
  },
  /**
   * The shared dashboard reads every user's campaigns, so it can't share the
   * `campaigns` key — the same params would collide with the owner-scoped list
   * and serve one screen the other's rows.
   */
  dashboard: {
    all: ["dashboard"] as const,
    lists: () => [...queryKeys.dashboard.all, "list"] as const,
    list: (params: ListKeyParams = {}) =>
      [...queryKeys.dashboard.lists(), params] as const,
    stats: (params: Pick<ListKeyParams, "q"> = {}) =>
      [...queryKeys.dashboard.all, "stats", params] as const,
  },
  images: {
    all: ["images"] as const,
    lists: () => [...queryKeys.images.all, "list"] as const,
    list: (params: ListKeyParams = {}) =>
      [...queryKeys.images.lists(), params] as const,
  },
} as const;

// Reference resources are keyed through `entityKeys` above — deliberately not
// duplicated here, so there's one way to name a clients/vendors/sales key.
