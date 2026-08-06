"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/http";
import { type ListKeyParams, queryKeys } from "@/lib/query-keys";
import { listQuery } from "@/lib/queries/entities";
import type { CampaignListView, CampaignStats, Page } from "@/lib/view-types";

/**
 * The shared dashboard's reads. Same shapes as the campaigns screen, different
 * endpoints and a separate query key: `/api/dashboard` is unscoped, so caching
 * it under `campaigns` would let one screen serve the other's rows.
 */
export function useDashboardQuery(params: ListKeyParams) {
  return useQuery({
    queryKey: queryKeys.dashboard.list(params),
    queryFn: () =>
      apiJson<Page<CampaignListView>>(`/api/dashboard${listQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

/** Live/Ended totals — reflects `q`, but never the status filter. */
export function useDashboardStatsQuery(q?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.stats({ q }),
    queryFn: () =>
      apiJson<CampaignStats>(
        `/api/dashboard/stats${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
    placeholderData: keepPreviousData,
  });
}
