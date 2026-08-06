"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiError, apiJson } from "@/lib/http";
import type { ShareSendResult } from "@/lib/view-types";

/**
 * Mail the campaign's sales person a preview link. Nothing in the app's caches
 * depends on it — the link is minted once per campaign and reused — so there
 * is nothing to invalidate on success.
 */
export function useSendPreviewLink() {
  return useMutation({
    mutationFn: ({ campaignId }: { campaignId: string }) =>
      apiJson<ShareSendResult>(`/api/campaigns/${campaignId}/share`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      toast.success(`Preview link sent to ${data.sentTo}`, {
        description: data.url,
        action: copyAction(data.url),
      });
    },
    onError: (error) => {
      const message =
        error instanceof ApiError
          ? apiError(error.data, "Could not send the preview link")
          : "Could not send the preview link";

      // A send can fail on SMTP alone — the link is minted first and stays
      // valid, so when the route hands one back it's offered for copying
      // rather than thrown away with the error.
      const url = error instanceof ApiError ? urlFrom(error.data) : null;
      toast.error(message, {
        description: url ? `The link still works: ${url}` : undefined,
        action: url ? copyAction(url) : undefined,
        duration: url ? 15_000 : undefined,
      });
    },
  });
}

function urlFrom(data: unknown): string | null {
  if (data && typeof data === "object" && "url" in data) {
    const url = (data as { url: unknown }).url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

function copyAction(url: string) {
  return {
    label: "Copy link",
    onClick: () => {
      navigator.clipboard
        ?.writeText(url)
        .then(() => toast.success("Link copied"))
        .catch(() => toast.error("Could not copy the link"));
    },
  };
}
