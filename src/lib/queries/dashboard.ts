"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiJson } from "@/lib/http";
import {
  type ListKeyParams,
  type StatsKeyParams,
  queryKeys,
} from "@/lib/query-keys";
import { listQuery } from "@/lib/queries/entities";
import type {
  CampaignListView,
  CampaignStats,
  Page,
  PersonView,
} from "@/lib/view-types";

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

/** Live/Ended totals — reflects the search and filters, never the status. */
export function useDashboardStatsQuery(params: StatsKeyParams) {
  return useQuery({
    queryKey: queryKeys.dashboard.stats(params),
    queryFn: () =>
      apiJson<CampaignStats>(`/api/dashboard/stats${listQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

/**
 * The backend users behind the Backend filter. Reference data that changes
 * about never, so it gets the same long staleTime as the entity comboboxes.
 */
export function useUserOptions() {
  return useQuery({
    queryKey: queryKeys.dashboard.userOptions(),
    queryFn: () => apiJson<PersonView[]>("/api/users/options"),
    staleTime: 5 * 60_000,
  });
}
