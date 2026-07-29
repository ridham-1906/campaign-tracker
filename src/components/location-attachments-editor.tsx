"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheetIcon,
  ImagePlusIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUploadAttachments } from "@/lib/queries/attachments";
import {
  ATTACHMENT_STAGES,
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  PHOTO_TYPES,
  PHOTO_TYPE_LABELS,
  STAGE_LABELS,
  formatAttachmentSize,
  validateAttachmentFile,
  type AttachmentKind,
  type AttachmentStage,
  type PhotoType,
} from "@/lib/attachments";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AttachmentView } from "@/lib/view-types";

/** The wire shape, shared with the server via lib/view-types.ts. */
export type AttachmentRow = AttachmentView;

/** The three photo stages plus the document bucket, flattened into one list so
 * picking a target is a single choice instead of "kind, then stage". */
type UploadType = AttachmentStage | "document";

const TYPE_OPTIONS: { value: UploadType; label: string }[] = [
  ...ATTACHMENT_STAGES.map((s) => ({ value: s as UploadType, label: STAGE_LABELS[s] })),
  { value: "document", label: "Creative deck" },
];

const TYPE_LABELS = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<UploadType, string>;

const PHOTO_TYPE_OPTIONS: { value: PhotoType; label: string }[] = PHOTO_TYPES.map(
  (p) => ({ value: p, label: PHOTO_TYPE_LABELS[p] }),
);

/** Thumbnails shown before the rest collapse into a "+N" tile. */
const PREVIEW_LIMIT = 6;

function countLabel(n: number, kind: AttachmentKind) {
  const noun = kind === "image" ? "image" : "file";
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A queued file plus its preview URL (empty for documents, which have none). */
type Picked = { file: File; url: string };

export type LocationUpload = ReturnType<typeof useLocationUpload>;

/**
 * Upload state for one location, as a hook so the host can put the submit
 * button wherever it likes — the wizard renders it in the dialog footer, next
 * to Back, rather than inline under the thumbnails.
 */
export function useLocationUpload({
  campaignId,
  locationId,
  onUploaded,
  initialType,
}: {
  campaignId: string;
  locationId: string;
  /** Fired after a fully successful batch so the host can close itself. */
  onUploaded?: () => void;
  /** Defaults the type picker — set when the host already knows what's
   * being added (e.g. opened from a specific location's empty gallery). */
  initialType?: UploadType;
}) {
  const [type, setType] = useState<UploadType>(initialType ?? "installation");
  const [photoType, setPhotoType] = useState<PhotoType>("newspaper");
  const [picked, setPicked] = useState<Picked[]>([]);

  const uploadAttachments = useUploadAttachments();
  const busy = uploadAttachments.isPending;

  const isDocument = type === "document";
  const kind: AttachmentKind = isDocument ? "document" : "image";

  /**
   * Preview URLs are created when a file is picked and revoked when it leaves
   * — both in event handlers, which is where side effects belong.
   *
   * They used to be built in a useMemo and revoked in an effect cleanup, which
   * broke every thumbnail: StrictMode runs mount → cleanup → mount, so the
   * cleanup revoked the URLs while the memo (same deps) handed the same, now
   * dead, strings back to the <img>s.
   */
  const liveUrls = useRef(new Set<string>());

  useEffect(
    () => () => {
      // Whatever is still queued when the editor unmounts.
      liveUrls.current.forEach((url) => URL.revokeObjectURL(url));
      liveUrls.current.clear();
    },
    [],
  );

  function release(items: Picked[]) {
    for (const item of items) {
      if (!item.url) continue;
      URL.revokeObjectURL(item.url);
      liveUrls.current.delete(item.url);
    }
  }

  /** Queue files, dropping any the server would reject rather than failing
   * the whole batch on one bad pick. */
  function addFiles(files: File[]) {
    const ok = files.filter((f) => !validateAttachmentFile(kind, f));
    const rejected = files.length - ok.length;
    if (rejected > 0) {
      toast.error(
        `${countLabel(rejected, kind)} skipped — wrong format or too large`,
      );
    }
    if (ok.length === 0) return;

    const next = ok.map((file) => {
      const url = kind === "image" ? URL.createObjectURL(file) : "";
      if (url) liveUrls.current.add(url);
      return { file, url };
    });
    setPicked((prev) => [...prev, ...next]);
  }

  function removeAt(index: number) {
    const gone = picked[index];
    // Outside the updater: setState updaters must stay pure, and StrictMode
    // may call them twice.
    if (gone) release([gone]);
    setPicked((prev) => prev.filter((_, i) => i !== index));
  }

  function clear() {
    release(picked);
    setPicked([]);
  }

  function changeType(next: UploadType) {
    // Queued files belong to the type they were picked for.
    release(picked);
    setPicked([]);
    setType(next);
  }

  function changePhotoType(next: PhotoType) {
    // Queued files belong to the photo type they were picked for.
    release(picked);
    setPicked([]);
    setPhotoType(next);
  }

  function submit() {
    if (picked.length === 0 || busy) return;

    uploadAttachments.mutate(
      {
        campaignId,
        locationId,
        kind,
        stage: isDocument ? undefined : type,
        photoType: isDocument ? undefined : photoType,
        files: picked.map((p) => p.file),
      },
      {
        onSuccess: ({ uploaded, firstError }) => {
          // Uploads run in order and stop at the first failure, so whatever
          // landed is the front of the queue — drop just those and leave the
          // rest queued for a retry.
          if (uploaded.length > 0) {
            const done = picked.slice(0, uploaded.length);
            release(done);
            setPicked((prev) => prev.slice(uploaded.length));
            toast.success(`${countLabel(uploaded.length, kind)} uploaded`);
          }
          if (firstError) {
            toast.error(firstError);
            return;
          }
          onUploaded?.();
        },
      },
    );
  }

  return {
    type,
    changeType,
    photoType,
    changePhotoType,
    kind,
    isDocument,
    picked,
    addFiles,
    removeAt,
    clear,
    submit,
    busy,
    canUpload: picked.length > 0 && !busy,
    count: picked.length,
  };
}

/**
 * Upload panel for one location: pick a type, pick files, review thumbnails.
 * The submit button is not here — the host renders it (see useLocationUpload).
 * Pure content, no Dialog wrapper, so it embeds in the wizard's second step.
 */
export function LocationAttachmentsEditor({
  locationLabel,
  upload,
}: {
  locationLabel: string;
  upload: LocationUpload;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label className="text-xs">Type of image</Label>
          <span className="truncate text-xs text-muted-foreground">
            {locationLabel}
          </span>
        </div>
        <div className={cn("grid gap-2", upload.isDocument ? "grid-cols-1" : "grid-cols-2")}>
          <Select
            value={upload.type}
            disabled={upload.busy}
            onValueChange={(v) => upload.changeType((v as UploadType) ?? "installation")}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: UploadType | null) => TYPE_LABELS[v ?? "installation"]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {!upload.isDocument && (
            <Select
              value={upload.photoType}
              disabled={upload.busy}
              onValueChange={(v) =>
                upload.changePhotoType((v as PhotoType) ?? "newspaper")
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: PhotoType | null) => PHOTO_TYPE_LABELS[v ?? "newspaper"]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PHOTO_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <DropZone kind={upload.kind} disabled={upload.busy} onFiles={upload.addFiles} />

      {upload.picked.length > 0 && (
        <SelectedFiles
          picked={upload.picked}
          kind={upload.kind}
          busy={upload.busy}
          onRemove={upload.removeAt}
          onClear={upload.clear}
        />
      )}
    </div>
  );
}

/** Click-or-drop target. The file input is a sibling, not a child — nesting it
 * makes the click `.click()` fires bubble back into this handler. */
function DropZone({
  kind,
  disabled,
  onFiles,
}: {
  kind: AttachmentKind;
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const isDocument = kind === "document";

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={(e) => {
          // Ignore bubbling leaves from children — only the zone itself counts.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) onFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          over
            ? "border-primary bg-primary/5"
            : "border-input hover:border-muted-foreground/50 hover:bg-muted/40",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {isDocument ? (
            <UploadCloudIcon className="size-5" />
          ) : (
            <ImagePlusIcon className="size-5" />
          )}
        </span>
        <p className="text-sm font-medium">
          Drop {isDocument ? "files" : "images"} here, or{" "}
          <span className="text-primary underline underline-offset-2">browse</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {isDocument
            ? `PPT, PPTX · up to ${formatAttachmentSize(MAX_DOCUMENT_BYTES)} each`
            : `JPG, PNG, WEBP · up to ${formatAttachmentSize(MAX_IMAGE_BYTES)} each`}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={isDocument ? DOCUMENT_ACCEPT : IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}

/** Files picked but not yet sent. Clear is the only action here — Upload lives
 * in the host's footer. */
function SelectedFiles({
  picked,
  kind,
  busy,
  onRemove,
  onClear,
}: {
  picked: Picked[];
  kind: AttachmentKind;
  busy: boolean;
  onRemove: (index: number) => void;
  onClear: () => void;
}) {
  const shown = picked.slice(0, PREVIEW_LIMIT);

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {countLabel(picked.length, kind)} ready to upload
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      {kind === "document" ? (
        <div className="space-y-1.5">
          {picked.map(({ file }, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm"
            >
              <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatAttachmentSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(i)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {shown.map(({ file, url }, i) => (
            <div
              key={`${file.name}-${i}`}
              className="group relative aspect-square overflow-hidden rounded-md border bg-background"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={file.name} className="size-full object-cover" />
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(i)}
                className="absolute top-1 right-1 rounded-md bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
          {picked.length > PREVIEW_LIMIT && (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed text-sm font-medium text-muted-foreground">
              +{picked.length - PREVIEW_LIMIT}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
