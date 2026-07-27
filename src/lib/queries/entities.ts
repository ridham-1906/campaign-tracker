"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiJson } from "@/lib/http";
import {
  type EntityKind,
  type ListKeyParams,
  entityKeys,
  queryKeys,
} from "@/lib/query-keys";
import type {
  NamedCountView,
  OptionView,
  Page,
  PersonView,
  SalesCountView,
} from "@/lib/view-types";

/** Clients and vendors share a name-only shape; sales adds an email. */
export type NamedResource = "clients" | "vendors";

const SINGULAR: Record<EntityKind, string> = {
  clients: "Client",
  vendors: "Vendor",
  sales: "Sales person",
};

function listQuery(params: ListKeyParams) {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.q) sp.set("q", params.q);
  if (params.sort) sp.set("sort", params.sort);
  if (params.dir) sp.set("dir", params.dir);
  if (params.status) sp.set("status", params.status);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export { listQuery };

// ---------------------------------------------------------------- options

/**
 * The complete list, for comboboxes that must resolve a selected id to a name.
 * Longer staleTime than the default: reference data changes rarely, and this
 * is fetched by every combobox on the campaign form.
 */
export function useEntityOptions(kind: EntityKind, enabled = true) {
  return useQuery({
    queryKey: entityKeys.options(kind),
    queryFn: () => apiJson<PersonView[]>(`/api/${kind}/options`),
    staleTime: 5 * 60_000,
    enabled,
  });
}

// ---------------------------------------------------------------- lists

export function useNamedListQuery(
  resource: NamedResource,
  params: ListKeyParams,
) {
  return useQuery({
    queryKey: entityKeys.list(resource, params),
    queryFn: () =>
      apiJson<Page<NamedCountView>>(`/api/${resource}${listQuery(params)}`),
    // Keeps the current page on screen while the next one loads, instead of
    // flashing an empty table between pages.
    placeholderData: keepPreviousData,
  });
}

export function useSalesListQuery(params: ListKeyParams) {
  return useQuery({
    queryKey: entityKeys.list("sales", params),
    queryFn: () => apiJson<Page<SalesCountView>>(`/api/sales${listQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------- mutations

/**
 * Create/update for clients and vendors. Lives here rather than in the form so
 * that both callers — the management page and the campaign form's inline
 * "create" — get cache invalidation without having to remember it.
 */
export function useSaveNamed(resource: NamedResource) {
  const queryClient = useQueryClient();
  const singular = SINGULAR[resource];

  return useMutation({
    mutationFn: ({ id, name }: { id?: string; name: string }) =>
      apiJson<OptionView>(
        id ? `/api/${resource}/${id}` : `/api/${resource}`,
        { method: id ? "PATCH" : "POST", body: JSON.stringify({ name }) },
      ),
    onSuccess: (saved, { id }) => {
      toast.success(`${singular} ${id ? "updated" : "added"}`);
      seedOptions(queryClient, resource, saved, !id);
      queryClient.invalidateQueries({ queryKey: entityKeys.all(resource) });
      // A rename changes the name rendered inside campaign rows.
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
    // Errors surface through the shared MutationCache handler.
  });
}

export function useSaveSales() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      name,
      email,
    }: {
      id?: string;
      name: string;
      email: string;
    }) =>
      apiJson<PersonView>(id ? `/api/sales/${id}` : `/api/sales`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({ name, email }),
      }),
    onSuccess: (saved, { id }) => {
      toast.success(`Sales person ${id ? "updated" : "added"}`);
      seedOptions(queryClient, "sales", saved, !id);
      queryClient.invalidateQueries({ queryKey: entityKeys.all("sales") });
      queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
    },
  });
}

/**
 * Write a newly-created record straight into the options cache.
 *
 * This is what replaces EntityCombobox's hand-rolled `extras` state: the
 * combobox can select the new id on the same tick, with no window where the
 * selected value isn't in its option list.
 */
function seedOptions(
  queryClient: ReturnType<typeof useQueryClient>,
  kind: EntityKind,
  saved: OptionView,
  isNew: boolean,
) {
  if (!isNew) return;
  queryClient.setQueryData<PersonView[]>(entityKeys.options(kind), (prev) =>
    prev
      ? [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
      : prev,
  );
}

export function useDeleteEntity(kind: EntityKind) {
  const queryClient = useQueryClient();
  const singular = SINGULAR[kind];

  return useMutation({
    mutationFn: (id: string) =>
      apiJson<{ ok: true; id: string }>(`/api/${kind}/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(`${singular} deleted`);
      queryClient.invalidateQueries({ queryKey: entityKeys.all(kind) });
    },
  });
}
