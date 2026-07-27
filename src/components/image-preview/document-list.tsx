"use client";

import { FileSpreadsheetIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAttachmentSize } from "@/lib/attachments";
import { CheckMark } from "@/components/image-preview/check-mark";
import { Badge } from "@/components/ui/badge";
import type { AttachmentView } from "@/lib/view-types";

/**
 * Creative decks have no thumbnail, so they list instead of sliding. Rows carry
 * no actions of their own — tick the ones you want and use the Download/Delete
 * menus above, the same way the image view works.
 */
export function DocumentList({
  items,
  selected,
  busy,
  onToggle,
}: {
  items: AttachmentView[];
  selected: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((doc) => (
        <div
          key={doc.id}
          className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm"
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.has(doc.id)}
            aria-label={`Select ${doc.filename}`}
            disabled={busy}
            onClick={() => onToggle(doc.id)}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-sm border",
              selected.has(doc.id)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input",
            )}
          >
            {selected.has(doc.id) && <CheckMark />}
          </button>

          <FileSpreadsheetIcon className="size-4 shrink-0 text-muted-foreground" />
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
          >
            {doc.filename}
          </a>
          <Badge variant="secondary" className="shrink-0 text-xs">
            {formatAttachmentSize(doc.size)}
          </Badge>
        </div>
      ))}
    </div>
  );
}
