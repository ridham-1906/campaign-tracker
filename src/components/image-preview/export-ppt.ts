"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  matchesPhotoFilter,
  matchesStageFilter,
  type PhotoFilter,
  type StageFilter,
} from "@/lib/attachments";
import { safeName } from "@/components/image-preview/download";
import type { ExportProgress, LocationExportEntry } from "@/lib/ppt/build-execution-ppt";
import type { LocationPreview } from "@/lib/view-types";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds the export deck's location entries — a location with no photo
 * matching both the chosen stage and photo-type filter is dropped entirely,
 * not given a placeholder. */
function toEntries(
  locations: LocationPreview[],
  stageFilter: StageFilter,
  photoFilter: PhotoFilter,
): LocationExportEntry[] {
  const entries: LocationExportEntry[] = [];
  for (const location of locations) {
    const photos = location.attachments.filter(
      (a) => matchesStageFilter(a, stageFilter) && matchesPhotoFilter(a, photoFilter),
    );
    if (photos.length === 0) continue;
    entries.push({ location, photos });
  }
  return entries;
}

/** Generates and downloads an execution deck, cloned from the uploaded
 * template. Loaded on demand — pptx generation is dead weight on every page
 * that isn't exporting one. */
export function useExportPpt() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>({ done: 0, total: 0 });

  async function exportPpt(
    campaignName: string,
    locations: LocationPreview[],
    stageFilter: StageFilter,
    photoFilter: PhotoFilter,
    filename: string,
  ) {
    if (exporting) return;
    const entries = toEntries(locations, stageFilter, photoFilter);
    if (entries.length === 0) {
      toast.error("No matching photos to export");
      return;
    }

    setExporting(true);
    setProgress({ done: 0, total: 0 });
    // A toast rather than relying solely on the trigger's own spinner — the
    // campaign row's "Export PPT" lives inside a dropdown that closes the
    // instant a filter is picked, so without this the user sees the menu
    // vanish and nothing else until the file lands seconds later.
    const toastId = toast.loading("Building execution deck…");
    try {
      const { buildExecutionPpt } = await import("@/lib/ppt/build-execution-ppt");
      const blob = await buildExecutionPpt({
        campaignName,
        entries,
        onProgress: (p) => {
          setProgress(p);
          if (p.total > 0) {
            toast.loading(`Building execution deck… ${p.done}/${p.total} photos`, {
              id: toastId,
            });
          }
        },
      });
      saveBlob(blob, `${safeName(filename)}.pptx`);
      toast.success("Execution deck exported", { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build the deck", {
        id: toastId,
      });
    } finally {
      setExporting(false);
    }
  }

  return { exporting, progress, exportPpt };
}
