"use client";

import { useState } from "react";
import type { AttachmentStage } from "@/lib/attachments";
import {
  useCampaignOptionsQuery,
  useCampaignQuery,
} from "@/lib/queries/campaigns";
import { SimpleCombobox } from "@/components/simple-combobox";
import { StepNav } from "@/components/step-nav";
import {
  LocationAttachmentsEditor,
  useLocationUpload,
} from "@/components/location-attachments-editor";
import { Button } from "@/components/ui/button";
import { Loader2Icon, UploadCloudIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STEPS = ["Campaign", "Location"] as const;

/**
 * Two-step "add images" flow: pick a campaign, then pick a location within
 * it and upload. The location picker stays live on step 2 — switching it
 * swaps which location the editor below targets, so several locations of
 * the same campaign can be worked through without leaving the dialog.
 *
 * Step/selection state resets on mount, not on `open` — the caller should
 * remount this (e.g. via a bumped `key`) each time it opens fresh.
 *
 * When opened from a context that already knows the campaign and location
 * (e.g. a location's own empty gallery), pass `initialCampaignId`/
 * `initialLocationId` — the campaign step is skipped entirely and the
 * location/upload step opens already pointed at that location.
 */
export function AddImagesWizard({
  open,
  onOpenChange,
  initialCampaignId,
  initialLocationId,
  initialType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCampaignId?: string;
  initialLocationId?: string;
  initialType?: AttachmentStage;
}) {
  const [step, setStep] = useState(initialCampaignId ? 1 : 0);
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? "");
  const [locationId, setLocationId] = useState(initialLocationId ?? "");

  // A light {id, clientName, locationCount} list for the picker, then the one
  // selected campaign in full. The wizard used to be handed every campaign
  // with all its locations and attachments up front.
  const { data: options = [] } = useCampaignOptionsQuery(open);
  const { data: campaign, isLoading: loadingCampaign } = useCampaignQuery(
    campaignId || null,
  );

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Locations arrive with the detail fetch rather than with the picker, so the
  // default selection is derived instead of set in the change handler.
  const effectiveLocationId =
    campaign?.locations.some((l) => l.id === locationId)
      ? locationId
      : (campaign?.locations[0]?.id ?? "");
  const location = campaign?.locations.find((l) => l.id === effectiveLocationId);

  // Owned here rather than inside the editor so Upload can sit in the footer
  // as the dialog's primary action. Keyed remount per location resets it.
  // No onUploaded callback — a successful batch already clears the picked
  // files (see useLocationUpload), and the dialog stays open so the user can
  // keep adding more to the same or another location without reopening it.
  const upload = useLocationUpload({
    campaignId,
    locationId: effectiveLocationId,
    initialType,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add images</DialogTitle>
        </DialogHeader>

        <StepNav steps={STEPS} current={step} onStep={setStep} />

        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-1">
          {currentStep === "Campaign" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign</Label>
              <SimpleCombobox
                label="campaigns"
                value={campaignId}
                onChange={(id) => {
                  setCampaignId(id);
                  setLocationId("");
                }}
                options={options.map((c) => ({
                  id: c.id,
                  name: `${c.clientName} — ${c.locationCount} location${
                    c.locationCount === 1 ? "" : "s"
                  }`,
                }))}
              />
            </div>
          )}

          {currentStep === "Location" &&
            (loadingCampaign && !campaign ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading locations…
              </p>
            ) : (
              campaign && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Location</Label>
                    <SimpleCombobox
                      label="locations"
                      value={effectiveLocationId}
                      onChange={setLocationId}
                      options={campaign.locations.map((l) => ({
                        id: l.id,
                        name: `${l.location} · ${l.city}`,
                      }))}
                    />
                  </div>

                  {location && (
                    <LocationAttachmentsEditor
                      locationLabel={`${location.location} · ${location.city}`}
                      upload={upload}
                    />
                  )}
                </div>
              )
            ))}
        </div>

        <div className="flex shrink-0 justify-between gap-2 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            disabled={upload.busy}
            onClick={step === 0 ? () => onOpenChange(false) : () => setStep(step - 1)}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          {!isLast ? (
            <Button
              type="button"
              disabled={!campaignId}
              onClick={() => setStep(step + 1)}
            >
              Next
            </Button>
          ) : (
            /* Upload is the dialog's primary action, so it sits here rather
               than inline under the thumbnails. A successful batch clears the
               thumbnails but leaves the dialog open for the next one. */
            <Button type="button" disabled={!upload.canUpload} onClick={upload.submit}>
              {upload.busy ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  {upload.progressLabel
                    ? `Uploading ${upload.progressLabel}`
                    : "Uploading…"}
                </>
              ) : (
                <>
                  <UploadCloudIcon />
                  Upload{upload.count > 0 ? ` ${upload.count}` : ""}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
