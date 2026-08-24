"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { Client, Storage } from "appwrite";
import { ApiError, apiError, apiJson } from "@/lib/http";
import { type ListKeyParams, queryKeys } from "@/lib/query-keys";
import { listQuery } from "@/lib/queries/entities";
import type { AttachmentKind, PhotoType } from "@/lib/attachments";
import type {
  AttachmentView,
  CampaignImagesRowView,
  CampaignView,
  Page,
} from "@/lib/view-types";

// ---------------------------------------------------------------- images list

export function useImagesQuery(params: ListKeyParams) {
  return useQuery({
    queryKey: queryKeys.images.list(params),
    queryFn: () =>
      apiJson<Page<CampaignImagesRowView>>(`/api/images${listQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------- upload

export type UploadBatch = {
  campaignId: string;
  locationId: string;
  kind: AttachmentKind;
  imageTypeId?: string;
  photoType?: PhotoType;
  files: File[];
  /** Called as the batch advances, so the caller can drive its own progress
   * UI: how many files are fully done, how many there are, and how far through
   * the one currently uploading (0-100). */
  onProgress?: (done: number, total: number, currentPct: number) => void;
};

export type UploadBatchResult = {
  uploaded: AttachmentView[];
  /** How many leading files landed — the caller drops that many from its queue. */
  failedFrom: number | null;
  firstError: string | null;
};

/** What the upload-ticket route hands back: where to upload, the credential to
 * do it with, and the file ids it has pre-authorised. */
type UploadGrant = {
  endpoint: string;
  projectId: string;
  bucketId: string;
  jwt: string;
  ticket: string;
  fileIds: string[];
  expiresAt: string;
};

function uploadErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return apiError(err.data, fallback);
  // An AppwriteException from the direct upload lands here.
  if (err instanceof Error && err.message) return `${fallback}: ${err.message}`;
  return fallback;
}

/**
 * Uploads a whole batch inside one mutation.
 *
 * The bytes go straight from the browser to Appwrite — Vercel caps a function's
 * request body at ~4.5MB, so routing files through our own API meant anything
 * larger failed at the edge. One ticket request authorises the batch (ownership,
 * kind, image type) and hands back a create-only Appwrite JWT plus the file ids
 * it has pre-authorised; each stored file is then registered with a small JSON
 * post that our server verifies against Appwrite.
 *
 * The loop stays sequential and stops at the first failure, exactly as before:
 * upload order is predictable, Appwrite isn't hit with a burst of concurrent
 * uploads, and whatever landed is the front of the queue so the caller can drop
 * just those and leave the rest to retry.
 *
 * A partial failure is deliberately NOT a mutation error — some files really
 * were stored and the cache must reflect that. It resolves with a tally and
 * the component decides what to toast. Progress stays plain useState in the
 * component; useMutation has no progress concept and shouldn't grow one.
 */
export function useUploadAttachments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (batch: UploadBatch): Promise<UploadBatchResult> => {
      const uploaded: AttachmentView[] = [];
      const total = batch.files.length;
      let firstError: string | null = null;

      batch.onProgress?.(0, total, 0);

      const base = `/api/campaigns/${batch.campaignId}/locations/${batch.locationId}/attachments`;

      let grant: UploadGrant;
      try {
        grant = await apiJson<UploadGrant>(`${base}/upload-ticket`, {
          method: "POST",
          body: JSON.stringify({
            kind: batch.kind,
            imageTypeId: batch.imageTypeId,
            photoType: batch.photoType,
            count: total,
          }),
        });
      } catch (err) {
        // Nothing was stored, so this is still a tally rather than a throw —
        // the caller toasts it the same way as a mid-batch failure.
        return {
          uploaded,
          failedFrom: 0,
          firstError: uploadErrorMessage(err, "Could not start the upload"),
        };
      }

      const storage = new Storage(
        new Client()
          .setEndpoint(grant.endpoint)
          .setProject(grant.projectId)
          .setJWT(grant.jwt),
      );

      for (const [i, file] of batch.files.entries()) {
        try {
          // The web SDK chunks anything over 5MB and reports progress per chunk.
          await storage.createFile({
            bucketId: grant.bucketId,
            fileId: grant.fileIds[i],
            file,
            onProgress: (p) => batch.onProgress?.(i, total, p.progress),
          });

          uploaded.push(
            await apiJson<AttachmentView>(base, {
              method: "POST",
              body: JSON.stringify({
                ticket: grant.ticket,
                fileId: grant.fileIds[i],
              }),
            }),
          );
        } catch (err) {
          firstError = uploadErrorMessage(err, `${file.name} failed to upload`);
          break;
        }
        batch.onProgress?.(i + 1, total, 0);
      }

      return {
        uploaded,
        failedFrom: firstError ? uploaded.length : null,
        firstError,
      };
    },

    onSuccess: (result, batch) => {
      if (result.uploaded.length === 0) return;
      // Splice the created rows into the cached campaign so the gallery
      // updates on the same tick, then reconcile in the background.
      patchCachedAttachments(
        queryClient,
        batch.campaignId,
        batch.locationId,
        (prev) => [
          ...prev,
          ...result.uploaded.filter((r) => !prev.some((a) => a.id === r.id)),
        ],
      );
      invalidateAttachmentViews(queryClient, batch.campaignId);
    },
  });
}

/** Reclassify an already-uploaded image's type and/or photo type. */
export type UpdateAttachmentInput = {
  campaignId: string;
  locationId: string;
  attachmentId: string;
  imageTypeId?: string;
  photoType?: PhotoType;
};

export function useUpdateAttachment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      campaignId,
      locationId,
      attachmentId,
      imageTypeId,
      photoType,
    }: UpdateAttachmentInput) =>
      apiJson<AttachmentView>(
        `/api/campaigns/${campaignId}/locations/${locationId}/attachments/${attachmentId}`,
        { method: "PATCH", body: JSON.stringify({ imageTypeId, photoType }) },
      ),

    onSuccess: (updated, { campaignId, locationId }) => {
      patchCachedAttachments(queryClient, campaignId, locationId, (prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
      invalidateAttachmentViews(queryClient, campaignId);
    },
  });
}

/**
 * Delete one or many attachments in a single request.
 *
 * Deliberately not a loop over the per-attachment route: every request pays a
 * full getSession(), which queries Mongo to confirm the user still exists, so
 * deleting 20 files meant 20 auth round-trips. The route does one deleteMany
 * and fans the Appwrite deletes out in parallel.
 *
 * It answers with the ids it actually removed, so a partial failure still
 * updates the cache precisely — the rest simply stay on screen.
 */
export function useDeleteAttachments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      campaignId,
      locationId,
      attachmentIds,
    }: {
      campaignId: string;
      locationId: string;
      /** Omit to clear every attachment on the location. */
      attachmentIds?: string[];
    }) =>
      apiJson<{ ok: true; deletedIds: string[] }>(
        `/api/campaigns/${campaignId}/locations/${locationId}/attachments`,
        {
          method: "DELETE",
          body: JSON.stringify(attachmentIds ? { ids: attachmentIds } : {}),
        },
      ),

    onSuccess: ({ deletedIds }, { campaignId, locationId }) => {
      if (deletedIds.length === 0) return;
      const gone = new Set(deletedIds);

      patchCachedAttachments(queryClient, campaignId, locationId, (prev) =>
        prev.filter((a) => !gone.has(a.id)),
      );
      invalidateAttachmentViews(queryClient, campaignId);
    },
  });
}

/** Apply a change to one location's attachments inside the cached campaign. */
function patchCachedAttachments(
  queryClient: QueryClient,
  campaignId: string,
  locationId: string,
  update: (prev: AttachmentView[]) => AttachmentView[],
) {
  queryClient.setQueryData<CampaignView>(
    queryKeys.campaigns.detail(campaignId),
    (campaign) =>
      campaign && {
        ...campaign,
        locations: campaign.locations.map((l) =>
          l.id === locationId ? { ...l, attachments: update(l.attachments) } : l,
        ),
      },
  );
}

/**
 * The campaign detail — which the preview dialog reads — and the images list
 * both derive from attachments, so a write to either invalidates both.
 */
function invalidateAttachmentViews(queryClient: QueryClient, campaignId: string) {
  queryClient.invalidateQueries({
    queryKey: queryKeys.campaigns.detail(campaignId),
  });
  queryClient.invalidateQueries({ queryKey: queryKeys.images.all });
}
