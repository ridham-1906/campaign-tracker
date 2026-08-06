"use client";

import { useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
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
import type {
  CampaignImagesRowView,
  CampaignView,
  LocationView,
} from "@/lib/view-types";

/**
 * Narrow a campaign's locations to one booking term.
 *
 * Renewing keeps everything on the same campaign, so a location's attachments
 * span every term it has run for. Showing them together would mix last term's
 * installation shots with this term's, and — because the deck labels each slide
 * with the location's dates — would date a past term's photos to the current
 * one. So the dates are rewound too, from the archived term, leaving each
 * location looking exactly as it did while that term was live.
 */
function locationsForTerm(campaign: CampaignView, term: number): LocationView[] {
  const archived = campaign.termHistory.find((t) => t.term === term);

  return campaign.locations
    .map((l): LocationView => {
      const dates = archived?.locations.find((a) => a.locationId === l.id);
      return {
        ...l,
        ...(dates
          ? {
              startDate: dates.startDate,
              midDate: dates.midDate,
              endDate: dates.endDate,
              days: dates.days,
            }
          : {}),
        attachments: l.attachments.filter((a) => a.term === term),
      };
    })
    // A location that hadn't been booked yet in the chosen term has neither
    // archived dates nor photos for it — showing it would just be an empty row.
    .filter((l) => l.attachments.length > 0 || archived === undefined);
}

/**
 * A campaign's uploads: pick a location, then browse that location's files by
 * type. Opened from a row of the images table, which is one whole campaign,
 * or from a single location expanded beneath it.
 *
 * Reads the campaign detail — which already carries every location's
 * attachments — so both steps come from one request, and uploads elsewhere in
 * the app keep the same cache warm.
 */
export function ImagePreviewDialog({
  row,
  locationId,
  open,
  onOpenChange,
  onAddImages,
}: {
  /** The clicked row; null while the dialog has never been opened. */
  row: CampaignImagesRowView | null;
  /** Preselects a location, skipping the picker — set when opened from one. */
  locationId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the add-images wizard pre-pointed at the given campaign/location —
   * the caller is expected to close this dialog itself. */
  onAddImages: (campaignId: string, locationId: string) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [picked, setPicked] = useState<string | null>(null);
  // Null means "whatever the campaign is on now" — so a renewal that lands
  // while the dialog is closed moves the default forward with it.
  const [term, setTerm] = useState<number | null>(null);

  // Each open() call may target a different location, and the dialog stays
  // mounted across opens, so `picked` is re-seeded from `locationId` the
  // moment `open` flips true — adjusted during render rather than an effect,
  // per https://react.dev/learn/you-might-not-need-an-effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicked(locationId ?? null);
      setTerm(null);
    }
  }

  const campaignId = row?.id ?? null;
  const query = useCampaignQuery(open ? campaignId : null);
  const campaign = query.data ?? null;
  const activeTerm = term ?? campaign?.term ?? 1;

  const locations = useMemo(
    () => (campaign ? locationsForTerm(campaign, activeTerm) : []),
    [campaign, activeTerm],
  );

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

          {/* Only a renewed campaign has more than one term to choose from. */}
          {campaign && campaign.term > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Term</span>
              {Array.from({ length: campaign.term }, (_, i) => i + 1).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTerm(t);
                    // The location list is term-scoped, so a location that has
                    // nothing in the newly picked term would leave the gallery
                    // pointing at a row that no longer exists.
                    setPicked(null);
                  }}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    t === activeTerm
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t}
                  {t === campaign.term && (
                    <span className="ml-1 opacity-70">(current)</span>
                  )}
                </button>
              ))}
            </div>
          )}

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
              onAddImages={() => onAddImages(campaignId, location.id)}
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
