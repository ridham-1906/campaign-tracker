"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderUpIcon, Loader2Icon, UploadCloudIcon, XIcon } from "lucide-react";
import {
  PHOTO_TYPE_LABELS,
  PHOTO_TYPES,
  type PhotoType,
} from "@/lib/attachments";
import { useCampaignLocationsIndexQuery } from "@/lib/queries/campaigns";
import { useImageTypeOptions } from "@/lib/queries/image-types";
import { useUploadAttachments } from "@/lib/queries/attachments";
import { matchFolderName } from "@/lib/folder-match";
import { parseFolderFiles } from "@/lib/folder-tree";
import { ImageTypePicker } from "@/components/image-type-picker";
import { SimpleCombobox } from "@/components/simple-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Chips shown per row before collapsing into "+N more". */
const CHIP_LIMIT = 8;

type RowFile = { file: File; photoType: PhotoType | null };

type Row = {
  /** The folder's own name, unique within one picked upload. */
  key: string;
  rawName: string;
  cleanedName: string;
  campaignId: string;
  locationId: string;
  matched: boolean;
  files: RowFile[];
  /** Applied to whichever files in this row couldn't be classified by name. */
  fallbackPhotoType: PhotoType;
};

/**
 * "Upload folder" — the browser's native directory picker, then a
 * best-effort read of the folder structure vendors actually export:
 * `<client>/<location>/<shot-type>.jpg` (e.g. "Redcliff/1. Ambegaon
 * D-Mart/GPS.jpeg"). Each location subfolder is matched against every
 * location the user owns (see lib/folder-match.ts) and each file's shot type
 * is guessed from its own name — "GPS", "Newspaper", "Normal" and their
 * common variants map straight to the app's photo categories.
 *
 * A folder with no location subfolders at all (just images loose in the
 * picked folder) still works — it becomes one row named after the picked
 * folder itself, same review screen either way.
 *
 * Nothing uploads until the user confirms the (editable) matches here and
 * hits Upload — each row can still be repointed at a different location, and
 * any file whose category couldn't be guessed falls back to a row-level pick.
 */
export function FolderUploadWizard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [topFolderName, setTopFolderName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [imageType, setImageType] = useState("");
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const { data: index = [] } = useCampaignLocationsIndexQuery();
  const { data: imageTypes = [] } = useImageTypeOptions();
  const uploadAttachments = useUploadAttachments();

  // Same "adjust during render" pattern as useLocationUpload: the default
  // can't be known until the DB-backed list loads.
  if (!imageType && imageTypes.length > 0) {
    const match = imageTypes.find((t) => t.role === "installation") ?? imageTypes[0];
    if (match) setImageType(match.id);
  }

  const locationOptions = useMemo(
    () =>
      index.map((e) => ({
        id: `${e.campaignId}:${e.locationId}`,
        name: `${e.clientName} — ${e.location} · ${e.city}`,
      })),
    [index],
  );

  function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const parsed = parseFolderFiles(files);

    const nextRows: Row[] = parsed.groups.map((group) => {
      const isFlat = group.rawName === parsed.topFolderName;
      const variants = isFlat
        ? [group.cleanedName]
        : [group.cleanedName, `${parsed.topFolderName} ${group.cleanedName}`];
      const match = matchFolderName(variants, index);

      return {
        key: group.rawName,
        rawName: group.rawName,
        cleanedName: group.cleanedName,
        campaignId: match?.entry.campaignId ?? "",
        locationId: match?.entry.locationId ?? "",
        matched: Boolean(match),
        files: group.files,
        fallbackPhotoType: "long_shot",
      };
    });

    setTopFolderName(parsed.topFolderName);
    setRows(nextRows);
    setOpen(true);
  }

  function setRowLocation(key: string, compositeId: string) {
    const [campaignId, locationId] = compositeId.split(":");
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, campaignId: campaignId ?? "", locationId: locationId ?? "" } : r,
      ),
    );
  }

  function setRowFallback(key: string, photoType: PhotoType) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, fallbackPhotoType: photoType } : r)),
    );
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const matchedCount = rows.filter((r) => r.locationId).length;
  const fileCount = rows.reduce((n, r) => n + r.files.length, 0);
  const canUpload = !busy && Boolean(imageType) && rows.some((r) => r.locationId);

  async function submit() {
    const active = rows.filter((r) => r.locationId && r.campaignId);
    if (active.length === 0) return;

    // One (location, photo type) pair per ticket — the upload API authorises
    // a single photo type per batch, and a location folder legitimately mixes
    // several (GPS, Newspaper, Normal…) in the same set of files.
    const buckets = active.flatMap((row) => {
      const byType = new Map<PhotoType, File[]>();
      for (const f of row.files) {
        const type = f.photoType ?? row.fallbackPhotoType;
        byType.set(type, [...(byType.get(type) ?? []), f.file]);
      }
      return Array.from(byType.entries()).map(([photoType, files]) => ({
        campaignId: row.campaignId,
        locationId: row.locationId,
        label: `${row.cleanedName} — ${PHOTO_TYPE_LABELS[photoType]}`,
        photoType,
        files,
      }));
    });

    setBusy(true);
    let uploadedTotal = 0;
    let errorCount = 0;

    for (const [i, bucket] of buckets.entries()) {
      setProgressLabel(`${bucket.label} (${i + 1} of ${buckets.length})`);
      try {
        const result = await uploadAttachments.mutateAsync({
          campaignId: bucket.campaignId,
          locationId: bucket.locationId,
          kind: "image",
          imageTypeId: imageType,
          photoType: bucket.photoType,
          files: bucket.files,
        });
        uploadedTotal += result.uploaded.length;
        if (result.firstError) {
          errorCount++;
          toast.error(`${bucket.label}: ${result.firstError}`);
        }
      } catch {
        errorCount++;
        toast.error(`${bucket.label} failed to upload`);
      }
    }

    setBusy(false);
    setProgressLabel(null);
    if (uploadedTotal > 0) {
      toast.success(`${uploadedTotal} image${uploadedTotal === 1 ? "" : "s"} uploaded`);
    }
    // Leftover rows are whatever didn't fully succeed — keep the dialog open
    // on those rather than losing track of a partial failure.
    if (errorCount === 0) {
      setOpen(false);
      setRows([]);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <FolderUpIcon />
        Upload folder
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        // Non-standard directory-picker attributes — not in React's DOM types.
        // @ts-expect-error webkitdirectory/directory aren't typed on <input>
        webkitdirectory=""
        directory=""
        onChange={(e) => {
          handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload folder</DialogTitle>
          </DialogHeader>

          <p className="text-xs text-muted-foreground">
            Found {rows.length} folder{rows.length === 1 ? "" : "s"} in “{topFolderName}”
            {" · "}
            {matchedCount} matched automatically
            {fileCount > 0 ? ` · ${fileCount} image${fileCount === 1 ? "" : "s"}` : ""}
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs">Type of image (applies to this whole upload)</Label>
            <ImageTypePicker value={imageType} onChange={setImageType} disabled={busy} />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto thin-scrollbar pr-1">
            {rows.map((row) => (
              <FolderRow
                key={row.key}
                row={row}
                locationOptions={locationOptions}
                disabled={busy}
                onLocationChange={(id) => setRowLocation(row.key, id)}
                onFallbackChange={(pt) => setRowFallback(row.key, pt)}
                onRemove={() => removeRow(row.key)}
              />
            ))}
            {rows.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing left to upload.
              </p>
            )}
          </div>

          <div className="flex shrink-0 justify-between gap-2 border-t pt-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!canUpload} onClick={submit}>
              {busy ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  {progressLabel ? `Uploading ${progressLabel}` : "Uploading…"}
                </>
              ) : (
                <>
                  <UploadCloudIcon />
                  Upload{fileCount > 0 ? ` ${fileCount}` : ""}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FolderRow({
  row,
  locationOptions,
  disabled,
  onLocationChange,
  onFallbackChange,
  onRemove,
}: {
  row: Row;
  locationOptions: { id: string; name: string }[];
  disabled: boolean;
  onLocationChange: (compositeId: string) => void;
  onFallbackChange: (photoType: PhotoType) => void;
  onRemove: () => void;
}) {
  const compositeId = row.locationId ? `${row.campaignId}:${row.locationId}` : "";
  const shown = row.files.slice(0, CHIP_LIMIT);
  const hasUnresolved = row.files.some((f) => !f.photoType);

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{row.rawName}</p>
            <Badge variant={row.locationId ? "secondary" : "outline"}>
              {row.matched ? "Matched" : row.locationId ? "Picked" : "No match"}
            </Badge>
          </div>
          <SimpleCombobox
            label="locations"
            value={compositeId}
            onChange={onLocationChange}
            options={locationOptions}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Skip ${row.rawName}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map(({ file, photoType }, i) => (
          <Badge key={`${file.name}-${i}`} variant={photoType ? "secondary" : "outline"}>
            {file.name}
            {photoType ? ` · ${PHOTO_TYPE_LABELS[photoType]}` : " · unclear"}
          </Badge>
        ))}
        {row.files.length > CHIP_LIMIT && (
          <span className="text-xs text-muted-foreground">
            +{row.files.length - CHIP_LIMIT} more
          </span>
        )}
      </div>

      {hasUnresolved && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Category for unclear files</Label>
          <Select
            value={row.fallbackPhotoType}
            disabled={disabled}
            onValueChange={(v) => onFallbackChange((v as PhotoType) ?? "long_shot")}
          >
            <SelectTrigger className="h-7 w-40 text-xs">
              <SelectValue>
                {(v: PhotoType | null) => PHOTO_TYPE_LABELS[v ?? "long_shot"]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PHOTO_TYPES.map((pt) => (
                <SelectItem key={pt} value={pt}>
                  {PHOTO_TYPE_LABELS[pt]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
