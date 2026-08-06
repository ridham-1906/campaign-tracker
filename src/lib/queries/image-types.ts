"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/lib/http";
import type { ImageTypeOption } from "@/lib/view-types";

const KEY = ["imageTypes", "options"] as const;

/** The full "type of image" list for the current user — seeded with the
 * three canonical stages (Installation/Mid date/End date) the first time
 * they're fetched, plus whatever custom types have been added since. */
export function useImageTypeOptions() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiJson<ImageTypeOption[]>("/api/image-types/options"),
    staleTime: 5 * 60_000,
  });
}

/** The "+ Add custom type" flow — idempotent by name server-side, so
 * retyping an existing name (e.g. "Installation") just selects it. */
export function useCreateImageType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      apiJson<ImageTypeOption>("/api/image-types", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<ImageTypeOption[]>(KEY, (prev) =>
        prev && !prev.some((t) => t.id === created.id) ? [...prev, created] : prev,
      );
    },
  });
}
