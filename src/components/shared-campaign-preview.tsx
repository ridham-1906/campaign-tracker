"use client";

import { useMemo, useState } from "react";
import {
  DownloadIcon,
  ImageIcon,
  Loader2Icon,
  Megaphone,
  PresentationIcon,
} from "lucide-react";
import { useAttachmentDownload } from "@/components/image-preview/download";
import { useExportPpt } from "@/components/image-preview/export-ppt";
import { LocationGallery } from "@/components/image-preview/gallery";
import { ExportPptButton } from "@/components/image-preview/photo-type-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SharePreviewView } from "@/lib/view-types";

/**
 * The page behind a preview link: one campaign's photos, browsable by whoever
 * holds the token. Same gallery the app uses, in read-only mode — browse,
 * download, export the deck; nothing that would need a session.
 */
export function SharedCampaignPreview({ data }: { data: SharePreviewView }) {
  const { locations, clientName } = data;

  // Open on a location that actually has files, so the page never lands on an
  // empty gallery while other locations are full.
  const [locationId, setLocationId] = useState(
    () => (locations.find((l) => l.attachments.length > 0) ?? locations[0])?.id ?? "",
  );

  const location = locations.find((l) => l.id === locationId) ?? locations[0] ?? null;

  const pptExport = useExportPpt();
  const zip = useAttachmentDownload();

  const allFiles = useMemo(
    () => locations.flatMap((l) => l.attachments),
    [locations],
  );

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Megaphone className="size-5 shrink-0" />
          <span className="truncate">Campaign&nbsp;Tracker</span>
        </div>
        <span className="truncate text-sm text-muted-foreground">
          Shared by {data.sharedBy}
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{clientName}</h1>
            <p className="text-sm text-muted-foreground">
              {locations.length} location{locations.length === 1 ? "" : "s"} ·{" "}
              {data.fileCount} file{data.fileCount === 1 ? "" : "s"} · this link
              does not expire
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={allFiles.length === 0 || zip.zipping}
              onClick={() => zip.download(allFiles, `${clientName} - All files`)}
            >
              {zip.zipping ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <DownloadIcon />
              )}
              {zip.zipping ? `Zipping ${zip.done}/${zip.total}` : "Download all"}
            </Button>

            {/* The whole campaign as one deck — the gallery's own export
                button below covers just the location on screen. */}
            <ExportPptButton
              label={
                pptExport.exporting
                  ? `Building ${pptExport.progress.done}/${pptExport.progress.total}`
                  : "Export PPT (all)"
              }
              icon={
                pptExport.exporting ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PresentationIcon />
                )
              }
              disabled={pptExport.exporting || data.fileCount === 0}
              onPick={(stage, filter) =>
                pptExport.exportPpt(
                  clientName,
                  locations,
                  stage,
                  filter,
                  `${clientName} - Execution`,
                )
              }
            />
          </div>
        </div>

        {locations.length > 1 && (
          <Select
            value={locationId}
            onValueChange={(v) => v && setLocationId(v)}
          >
            <SelectTrigger aria-label="Location" className="w-full sm:w-96">
              <SelectValue>
                {(v: string | null) => {
                  const picked = locations.find((l) => l.id === v);
                  return picked
                    ? `${picked.location} · ${picked.city}`
                    : "Select a location";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.location} · {l.city} ({l.attachments.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Card className="flex-1">
          <CardContent className="flex h-[70vh] flex-col gap-4">
            {location ? (
              <LocationGallery
                // Remounted per location so the type, slide position and
                // selection never carry across.
                key={location.id}
                clientName={clientName}
                location={location}
                readOnly
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <ImageIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Nothing has been uploaded to this campaign yet.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
