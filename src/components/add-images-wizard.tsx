"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SimpleCombobox } from "@/components/simple-combobox";
import { LocationAttachmentsEditor } from "@/components/location-attachments-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignRow } from "@/components/campaign-manager";

const STEPS = ["Campaign", "Location"] as const;

/**
 * Two-step "add images" flow: pick a campaign, then pick a location within
 * it and upload. The location picker stays live on step 2 — switching it
 * swaps which location the editor below targets, so several locations of
 * the same campaign can be worked through without leaving the dialog.
 *
 * Step/selection state resets on mount, not on `open` — the caller should
 * remount this (e.g. via a bumped `key`) each time it opens fresh.
 */
export function AddImagesWizard({
  open,
  onOpenChange,
  campaigns,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: CampaignRow[];
  onChanged: () => void;
}) {
  const [step, setStep] = useState(0);
  const [campaignId, setCampaignId] = useState("");
  const [locationId, setLocationId] = useState("");

  const campaign = campaigns.find((c) => c.id === campaignId);
  const location = campaign?.locations.find((l) => l.id === locationId);
  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const stepValid = currentStep === "Campaign" ? Boolean(campaignId) : Boolean(locationId);

  function selectCampaign(id: string) {
    setCampaignId(id);
    const first = campaigns.find((c) => c.id === id)?.locations[0];
    setLocationId(first?.id ?? "");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add images</DialogTitle>
        </DialogHeader>

        <ol className="flex shrink-0 items-center gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                      ? "text-foreground hover:bg-muted"
                      : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full text-[10px] font-medium",
                    i === step
                      ? "bg-primary-foreground text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                {label}
              </button>
              {i < STEPS.length - 1 && (
                <span className="text-muted-foreground/40">›</span>
              )}
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-1">
          {currentStep === "Campaign" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign</Label>
              <SimpleCombobox
                label="campaigns"
                value={campaignId}
                onChange={selectCampaign}
                options={campaigns.map((c) => ({
                  id: c.id,
                  name: `${c.client.name} — ${c.locations.length} location${
                    c.locations.length === 1 ? "" : "s"
                  }`,
                }))}
              />
            </div>
          )}

          {currentStep === "Location" && campaign && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Location</Label>
                <SimpleCombobox
                  label="locations"
                  value={locationId}
                  onChange={setLocationId}
                  options={campaign.locations.map((l) => ({
                    id: l.id,
                    name: `${l.location} · ${l.city}`,
                  }))}
                />
              </div>

              {location && (
                <LocationAttachmentsEditor
                  key={location.id}
                  campaignId={campaign.id}
                  locationId={location.id}
                  locationLabel={`${location.location} · ${location.city}`}
                  attachments={location.attachments}
                  onChanged={onChanged}
                />
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-between gap-2 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            onClick={step === 0 ? () => onOpenChange(false) : () => setStep(step - 1)}
          >
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          {!isLast && (
            <Button
              type="button"
              disabled={!stepValid}
              onClick={() => setStep(step + 1)}
            >
              Next
            </Button>
          )}
          {isLast && (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
