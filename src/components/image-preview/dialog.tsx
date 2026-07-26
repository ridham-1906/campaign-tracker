"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { useCampaignQuery } from "@/lib/queries/campaigns";
import { LocationGallery } from "@/components/image-preview/gallery";
import { LocationStep } from "@/components/image-preview/location-step";
import { useConfirm } from "@/components/use-confirm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignImagesRowView } from "@/lib/view-types";

/**
 * A campaign's uploads: pick a location, then browse that location's files by
 * type. Opened from a row of the images table, which is one whole campaign.
 *
 * Reads the campaign detail — which already carries every location's
 * attachments — so both steps come from one request, and uploads elsewhere in
 * the app keep the same cache warm.
 */
export function ImagePreviewDialog({
  row,
  open,
  onOpenChange,
}: {
  /** The clicked row; null while the dialog has never been opened. */
  row: CampaignImagesRowView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [picked, setPicked] = useState<string | null>(null);

  const campaignId = row?.id ?? null;
  const query = useCampaignQuery(open ? campaignId : null);
  const locations = query.data?.locations ?? [];

  // A single-location campaign has nothing to choose, so it skips the step.
  const only = locations.length === 1 ? locations[0].id : null;
  const activeId = picked ?? only;
  const location = locations.find((l) => l.id === activeId) ?? null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Everything inside DialogContent unmounts on close, so the gallery's
          // type and selection reset themselves. `picked` lives out here, which
          // makes it the one thing to clear for a reopen to start fresh.
          if (!next) setPicked(null);
          onOpenChange(next);
        }}
      >
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{row?.clientName ?? "Images"}</DialogTitle>
            <DialogDescription>
              {location
                ? `${location.location} · ${location.city}`
                : row
                  ? `${row.locationCount} location${
                      row.locationCount === 1 ? "" : "s"
                    } · ${row.fileCount} file${row.fileCount === 1 ? "" : "s"}`
                  : null}
            </DialogDescription>
          </DialogHeader>

          {query.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : location && campaignId ? (
            <LocationGallery
              // Remounted per location so the type, slide position and
              // selection never carry across.
              key={location.id}
              clientName={row?.clientName ?? ""}
              campaignId={campaignId}
              location={location}
              confirm={confirm}
              onBack={only ? undefined : () => setPicked(null)}
            />
          ) : (
            <LocationStep locations={locations} onSelect={setPicked} />
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </>
  );
}
