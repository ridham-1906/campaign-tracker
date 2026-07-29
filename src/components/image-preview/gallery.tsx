"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  DownloadIcon,
  ImagePlusIcon,
  Loader2Icon,
  PencilIcon,
  PresentationIcon,
  Trash2Icon,
} from "lucide-react";
import {
  ATTACHMENT_STAGES,
  ATTACHMENT_TYPES,
  PHOTO_TYPES,
  PHOTO_TYPE_LABELS,
  STAGE_LABELS,
  TYPE_LABELS,
  attachmentTypeOf,
  countByType,
  type AttachmentStage,
  type AttachmentType,
  type PhotoType,
} from "@/lib/attachments";
import { cn } from "@/lib/utils";
import { useDeleteAttachments, useUpdateAttachment } from "@/lib/queries/attachments";
import { CheckMark } from "@/components/image-preview/check-mark";
import { DocumentList } from "@/components/image-preview/document-list";
import { useAttachmentDownload } from "@/components/image-preview/download";
import { useExportPpt } from "@/components/image-preview/export-ppt";
import { ExportPptButton } from "@/components/image-preview/photo-type-menu";
import { ScopeMenu, type Scope } from "@/components/image-preview/scope-menu";
import { Stage } from "@/components/image-preview/stage";
import type { ConfirmOptions } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AttachmentView, LocationView } from "@/lib/view-types";

/**
 * One location's files: pick a type, page through the images, and download or
 * delete the current file, the ticked ones, or all of them.
 */
export function LocationGallery({
  clientName,
  campaignId,
  location,
  confirm,
  onBack,
  onAddImages,
}: {
  clientName: string;
  campaignId: string;
  location: LocationView;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Omitted when the campaign has a single location — nothing to go back to. */
  onBack?: () => void;
  /** Opens the add-images wizard already pointed at this location. */
  onAddImages?: () => void;
}) {
  const deleteAttachments = useDeleteAttachments();
  const updateAttachment = useUpdateAttachment();
  const zip = useAttachmentDownload();
  const pptExport = useExportPpt();

  const counts = useMemo(
    () => countByType(location.attachments),
    [location.attachments],
  );

  // Opening on an empty type would look like the location has nothing.
  const [type, setType] = useState<AttachmentType>(
    () => ATTACHMENT_TYPES.find((t) => counts[t]) ?? "installation",
  );
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which way the last move went, so the incoming image slides in from the
  // side it came from.
  const [direction, setDirection] = useState<1 | -1>(1);

  const items = useMemo(
    () => location.attachments.filter((a) => attachmentTypeOf(a) === type),
    [location.attachments, type],
  );

  // Deletes and type switches both shrink the list under the cursor, so clamp
  // rather than letting `current` go undefined.
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const isDocument = type === "document";
  const current = isDocument ? undefined : items[safeIndex];

  // Reclassifying the current image — its own small form rather than a
  // dialog, since there's already one file on screen to apply it to.
  const [editing, setEditing] = useState(false);
  const [editStage, setEditStage] = useState<AttachmentStage>("installation");
  const [editPhotoType, setEditPhotoType] = useState<PhotoType>("newspaper");

  function startEdit() {
    if (!current) return;
    setEditStage((current.stage as AttachmentStage | null) ?? "installation");
    setEditPhotoType((current.photoType as PhotoType | null) ?? "newspaper");
    setEditing(true);
  }

  function saveEdit() {
    if (!current) return;
    updateAttachment.mutate(
      {
        campaignId,
        locationId: location.id,
        attachmentId: current.id,
        stage: editStage,
        photoType: editPhotoType,
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success("Attachment updated");
        },
      },
    );
  }

  const step = useCallback(
    (delta: 1 | -1) => {
      setIndex((i) => {
        if (items.length === 0) return 0;
        const from = Math.min(i, items.length - 1);
        const next = from + delta;
        // Stops at both ends rather than wrapping — the arrows disable there,
        // so wrapping would contradict what the buttons say.
        if (next < 0 || next >= items.length) return from;
        return next;
      });
      setDirection(delta);
      // The edit form targets whatever is current — moving on invalidates it.
      setEditing(false);
    },
    [items.length],
  );

  // Arrow keys page through, matching what the chevrons do.
  useEffect(() => {
    if (isDocument) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDocument, step]);

  function changeType(next: AttachmentType) {
    setType(next);
    setIndex(0);
    setSelected(new Set());
    setEditing(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((a) => a.id)),
    );
  }

  /** Turns a menu pick into the files it acts on, plus the phrase the confirm
   * dialog uses to name them. */
  function resolve(scope: Scope): { list: AttachmentView[]; what: string } {
    if (scope === "current") {
      return { list: current ? [current] : [], what: "this file" };
    }
    if (scope === "selected") {
      const list = items.filter((a) => selected.has(a.id));
      return {
        list,
        what: `${list.length} selected file${list.length === 1 ? "" : "s"}`,
      };
    }
    return {
      list: items,
      what: `all ${items.length} ${TYPE_LABELS[type].toLowerCase()} file${
        items.length === 1 ? "" : "s"
      }`,
    };
  }

  async function runDelete(list: AttachmentView[], what: string) {
    if (list.length === 0) return;

    const ok = await confirm({
      title: `Delete ${what}?`,
      description:
        list.length === 1
          ? `"${list[0].filename}" will be permanently deleted.`
          : `${list.length} files will be permanently deleted. This cannot be undone.`,
      confirmLabel: `Delete ${list.length === 1 ? "file" : `${list.length} files`}`,
    });
    if (!ok) return;

    // Whatever this scope covers may include the file the edit form targets.
    setEditing(false);

    deleteAttachments.mutate(
      {
        campaignId,
        locationId: location.id,
        attachmentIds: list.map((a) => a.id),
      },
      {
        onSuccess: ({ deletedIds }) => {
          if (deletedIds.length === 0) return;
          const gone = new Set(deletedIds);
          setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
          toast.success(
            `${deletedIds.length} file${deletedIds.length === 1 ? "" : "s"} deleted`,
          );
        },
      },
    );
  }

  const busy = deleteAttachments.isPending;
  const allSelected = items.length > 0 && selected.size === items.length;
  const locationLabel = `${location.location} · ${location.city}`;

  return (
    <>
      {/* One row of equal-height controls: where you are, what you're looking
          at, and what to do with it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="bg-foreground/80 text-background hover:bg-foreground hover:text-background"
            disabled={busy || zip.zipping}
            onClick={onBack}
          >
            <ChevronLeftIcon />
            Location
          </Button>
        )}

        <Select
          value={type}
          disabled={busy}
          onValueChange={(v) => changeType((v as AttachmentType) ?? "installation")}
        >
          <SelectTrigger size="sm" aria-label="File type" className="w-48">
            <SelectValue>
              {(v: AttachmentType | null) => TYPE_LABELS[v ?? "installation"]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ATTACHMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
                {counts[t] ? ` (${counts[t]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Two controls, each asking the same question — what should this
            apply to? — so there is nothing to weigh up before clicking. */}
        <div className="ml-auto flex items-center gap-2">
          {onAddImages && (
            <Button type="button" variant="outline" size="sm" onClick={onAddImages}>
              <ImagePlusIcon />
              Add images
            </Button>
          )}
          {!isDocument && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!current || busy || editing}
              onClick={startEdit}
            >
              <PencilIcon />
              Edit
            </Button>
          )}
          <ScopeMenu
            label={zip.zipping ? `Zipping ${zip.done}/${zip.total}` : "Download"}
            icon={
              zip.zipping ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <DownloadIcon />
              )
            }
            variant="outline"
            disabled={items.length === 0 || zip.zipping || busy}
            hasCurrent={Boolean(current)}
            selectedCount={selected.size}
            totalCount={items.length}
            onPick={(scope) =>
              zip.download(
                resolve(scope).list,
                `${clientName} - ${locationLabel} - ${TYPE_LABELS[type]}`,
              )
            }
          />
          <ExportPptButton
            label={
              pptExport.exporting
                ? `Building ${pptExport.progress.done}/${pptExport.progress.total}`
                : "Export PPT"
            }
            icon={
              pptExport.exporting ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <PresentationIcon />
              )
            }
            disabled={pptExport.exporting || busy}
            onPick={(stage, filter) =>
              pptExport.exportPpt(
                clientName,
                [location],
                stage,
                filter,
                `${clientName} - ${locationLabel} - Execution`,
              )
            }
          />
          <ScopeMenu
            label="Delete"
            icon={busy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
            variant="destructive"
            disabled={items.length === 0 || busy}
            hasCurrent={Boolean(current)}
            selectedCount={selected.size}
            totalCount={items.length}
            onPick={(scope) => {
              const { list, what } = resolve(scope);
              runDelete(list, what);
            }}
          />
        </div>
      </div>

      {editing && current && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
          <Select
            value={editStage}
            disabled={updateAttachment.isPending}
            onValueChange={(v) =>
              setEditStage((v as AttachmentStage) ?? "installation")
            }
          >
            <SelectTrigger size="sm" aria-label="Stage" className="w-40">
              <SelectValue>
                {(v: AttachmentStage | null) => STAGE_LABELS[v ?? "installation"]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ATTACHMENT_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={editPhotoType}
            disabled={updateAttachment.isPending}
            onValueChange={(v) =>
              setEditPhotoType((v as PhotoType) ?? "newspaper")
            }
          >
            <SelectTrigger size="sm" aria-label="Photo type" className="w-40">
              <SelectValue>
                {(v: PhotoType | null) => PHOTO_TYPE_LABELS[v ?? "newspaper"]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PHOTO_TYPES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PHOTO_TYPE_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={updateAttachment.isPending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={updateAttachment.isPending}
              onClick={saveEdit}
            >
              {updateAttachment.isPending && (
                <Loader2Icon className="animate-spin" />
              )}
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing uploaded to {TYPE_LABELS[type]} for this location yet.
            </p>
            {onAddImages && (
              <Button type="button" size="sm" onClick={onAddImages}>
                <ImagePlusIcon />
                Add images
              </Button>
            )}
          </div>
        ) : isDocument ? (
          <DocumentList
            items={items}
            selected={selected}
            busy={busy}
            onToggle={toggle}
          />
        ) : (
          <Stage
            item={current}
            index={safeIndex}
            total={items.length}
            direction={direction}
            selected={current ? selected.has(current.id) : false}
            busy={busy}
            onStep={step}
            onToggle={toggle}
          />
        )}
      </div>

      {items.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-t pt-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected}
            disabled={busy}
            onClick={toggleAll}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors active:scale-[0.98] disabled:opacity-50",
              allSelected
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-foreground/80 text-background hover:bg-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-sm border-2",
                allSelected
                  ? "border-primary-foreground bg-primary-foreground text-primary"
                  : "border-background",
              )}
            >
              {allSelected && <CheckMark />}
            </span>
            Select all
          </button>
          <span className="text-xs text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} of ${items.length} selected`
              : `${items.length} file${items.length === 1 ? "" : "s"}`}
          </span>
        </div>
      )}
    </>
  );
}
