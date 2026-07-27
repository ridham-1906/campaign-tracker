"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiError, apiJson } from "@/lib/http";
import {
  ENTITY_KINDS,
  type ListKeyParams,
  entityKeys,
  queryKeys,
} from "@/lib/query-keys";
import { listQuery } from "@/lib/queries/entities";
import type {
  CampaignListView,
  CampaignStats,
  CampaignView,
  Page,
} from "@/lib/view-types";

export type CampaignOption = {
  id: string;
  clientName: string;
  locationCount: number;
};

export type LocationPayload = {
  id?: string;
  city: string;
  location: string;
  type: string;
  vendorId: string;
  startDate: string;
  endDate: string;
  status: string;
};

export type CampaignPayload = {
  clientId: string;
  salesId: string;
  locations: LocationPayload[];
};

// ---------------------------------------------------------------- queries

export function useCampaignsQuery(params: ListKeyParams) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(params),
    queryFn: () =>
      apiJson<Page<CampaignListView>>(`/api/campaigns${listQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

/** Totals for the stat tiles — reflects `q`, but never the status filter. */
export function useCampaignStatsQuery(q?: string) {
  return useQuery({
    queryKey: queryKeys.campaigns.stats({ q }),
    queryFn: () =>
      apiJson<CampaignStats>(`/api/campaigns/stats${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    placeholderData: keepPreviousData,
  });
}

/** The full campaign including attachments. Used by the add-images wizard. */
export function useCampaignQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? ""),
    queryFn: () => apiJson<CampaignView>(`/api/campaigns/${id}`),
    enabled: Boolean(id),
  });
}

export function useCampaignOptionsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaigns.options(),
    queryFn: () => apiJson<CampaignOption[]>("/api/campaigns/options"),
    staleTime: 60_000,
    enabled,
  });
}

// ---------------------------------------------------------------- mutations

export function useSaveCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string | null;
      payload: CampaignPayload;
    }) =>
      apiJson<CampaignView>(id ? `/api/campaigns/${id}` : "/api/campaigns", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (_data, { id }) => {
      toast.success(`Campaign ${id ? "updated" : "created"}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      // Editing a campaign can drop locations, which deletes their
      // attachments — so the images list may no longer be accurate.
      queryClient.invalidateQueries({ queryKey: queryKeys.images.all });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ ok: true; id: string }>(`/api/campaigns/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success("Campaign deleted");
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.images.all });
      // Every "in use by N campaigns" count on the reference screens shifts.
      for (const kind of ENTITY_KINDS) {
        queryClient.invalidateQueries({ queryKey: entityKeys.all(kind) });
      }
    },
  });
}

export function useSendReminder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      campaignId,
      locationId,
    }: {
      campaignId: string;
      locationId?: string;
      /** Carried through to onSuccess for the toast; not sent to the server. */
      recipient?: string;
    }) =>
      apiJson<{ ok: true; sentTo: string; locations: number }>(
        `/api/campaigns/${campaignId}/send-reminder`,
        {
          method: "POST",
          body: JSON.stringify(locationId ? { locationId } : {}),
        },
      ),
    onSuccess: (data, { recipient }) => {
      const n = data?.locations ?? 1;
      toast.success(
        `Reminder for ${n} location${n === 1 ? "" : "s"} sent to ${
          recipient ?? data.sentTo
        }`,
      );
      // The route rewrites reminderDate/reminderSent/reminderSentAt on the
      // locations it covered, which drives both the "Next reminder" badge and
      // the "Reminders sent today" tile.
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError
          ? apiError(error.data, "Failed to send")
          : "Failed to send",
      ),
  });
}
