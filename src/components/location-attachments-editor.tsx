"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheetIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { apiError, apiFetch, apiUpload } from "@/lib/http";
import {
  ATTACHMENT_STAGES,
  DOCUMENT_ACCEPT,
  IMAGE_ACCEPT,
  STAGE_LABELS,
  formatAttachmentSize,
  validateAttachmentFile,
  type AttachmentKind,
  type AttachmentStage,
} from "@/lib/attachments";
import { useConfirm } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";

/** Client-safe mirror of `AttachmentView` from lib/data.ts — that module is
 * server-only, so this component keeps its own shape, same as LocationRow
 * does for LocationView in campaign-manager.tsx. */
export type AttachmentRow = {
  id: string;
  kind: AttachmentKind;
  stage: AttachmentStage | null;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  url: string;
};

/**
 * The photo/document manager for one location: Installation / Mid date /
 * End date galleries plus a Creative deck section. Pure content — no Dialog
 * wrapper — so it can be embedded directly in the add-images wizard's second
 * step as well as anywhere else that wants to edit one location's files.
 */
export function LocationAttachmentsEditor({
  campaignId,
  locationId,
  locationLabel,
  attachments,
  onChanged,
}: {
  campaignId: string;
  locationId: string;
  locationLabel: string;
  attachments: AttachmentRow[];
  onChanged: () => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [uploading, setUploading] = useState(false);

  async function upload(
    kind: AttachmentKind,
    stage: AttachmentStage | undefined,
    file: File,
  ) {
    const err = validateAttachmentFile(kind, file);
    if (err) {
      toast.error(err);
      return;
    }

    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    if (stage) fd.append("stage", stage);

    const res = await apiUpload(
      `/api/campaigns/${campaignId}/locations/${locationId}/attachments`,
      fd,
    );
    if (!res.ok) {
      toast.error(apiError(res.data, "Upload failed"));
      return;
    }
    onChanged();
  }

  async function uploadMany(
    kind: AttachmentKind,
    stage: AttachmentStage | undefined,
    files: FileList | null,
  ) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      // Sequential, not parallel: keeps upload order predictable and avoids
      // hammering the API with many concurrent multipart requests at once.
      await upload(kind, stage, file);
    }
    setUploading(false);
    toast.success(files.length === 1 ? "Uploaded" : `Uploaded ${files.length} files`);
  }

  async function remove(attachment: AttachmentRow) {
    const ok = await confirm({
      title: attachment.kind === "image" ? "Delete photo?" : "Delete document?",
      description: `"${attachment.filename}" will be permanently deleted.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;

    const res = await apiFetch(
      `/api/campaigns/${campaignId}/locations/${locationId}/attachments/${attachment.id}`,
      { method: "DELETE" },
    );
    if (!res.ok) return toast.error(apiError(res.data));
    toast.success("Deleted");
    onChanged();
  }

  const photosFor = (stage: AttachmentStage) =>
    attachments.filter((a) => a.kind === "image" && a.stage === stage);
  const documents = attachments.filter((a) => a.kind === "document");

  return (
    <div className="space-y-5">
      <p className="text-xs font-medium text-muted-foreground">{locationLabel}</p>

      {ATTACHMENT_STAGES.map((stage) => (
        <PhotoSection
          key={stage}
          label={STAGE_LABELS[stage]}
          photos={photosFor(stage)}
          uploading={uploading}
          onUpload={(files) => uploadMany("image", stage, files)}
          onDelete={remove}
        />
      ))}

      <DocumentSection
        documents={documents}
        uploading={uploading}
        onUpload={(files) => uploadMany("document", undefined, files)}
        onDelete={remove}
      />

      {confirmDialog}
    </div>
  );
}

function PhotoSection({
  label,
  photos,
  uploading,
  onUpload,
  onDelete,
}: {
  label: string;
  photos: AttachmentRow[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onDelete: (attachment: AttachmentRow) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon />
          Add photos
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            onUpload(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {photos.length === 0 ? (
        <p className="text-xs text-muted-foreground">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.filename}
                className="size-full object-cover"
              />
              <button
                type="button"
                aria-label={`Delete ${photo.filename}`}
                onClick={() => onDelete(photo)}
                className="absolute top-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentSection({
  documents,
  uploading,
  onUpload,
  onDelete,
}: {
  documents: AttachmentRow[];
  uploading: boolean;
  onUpload: (files: FileList | null) => void;
  onDelete: (attachment: AttachmentRow) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">Creative deck</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <UploadIcon />
          Add file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            onUpload(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">No files yet.</p>
      ) : (
        <div className="space-y-1.5">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
              >
                {doc.filename}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatAttachmentSize(doc.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${doc.filename}`}
                onClick={() => onDelete(doc)}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
