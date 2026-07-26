"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/campaign";
import { formatAttachmentSize } from "@/lib/attachments";
import { CheckMark } from "@/components/image-preview/check-mark";
import type { AttachmentView } from "@/lib/view-types";

/**
 * The image, with prev/next, a position counter, and its own select control.
 *
 * There's no thumbnail strip: selection rides on the image itself, so the only
 * way to pick images is to page through them. `Select all` in the footer covers
 * the bulk case, and the footer count is what confirms an off-screen selection
 * is still held.
 */
export function Stage({
  item,
  index,
  total,
  direction,
  selected,
  busy,
  onStep,
  onToggle,
}: {
  item: AttachmentView | undefined;
  index: number;
  total: number;
  /** Which way the last move went, so the image slides in from that side. */
  direction: 1 | -1;
  selected: boolean;
  busy: boolean;
  onStep: (delta: 1 | -1) => void;
  onToggle: (id: string) => void;
}) {
  if (!item) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border bg-muted/30">
      <div className="flex h-[55vh] items-center justify-center">
        {/* Keyed on the file so React swaps the node and the entry animation
            replays; without it the same <img> would just change src. */}
        <div
          key={item.id}
          className={cn(
            "flex size-full items-center justify-center animate-in fade-in duration-200 ease-out",
            direction === 1 ? "slide-in-from-right-8" : "slide-in-from-left-8",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.url}
            alt={item.filename}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={selected ? `Deselect ${item.filename}` : `Select ${item.filename}`}
        disabled={busy}
        onClick={() => onToggle(item.id)}
        className={cn(
          "absolute top-3 right-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium shadow-sm ring-1 transition-colors",
          selected
            ? "bg-primary text-primary-foreground ring-primary"
            : "bg-background/85 text-foreground ring-foreground/10 hover:bg-background",
        )}
      >
        <span
          className={cn(
            "flex size-3.5 items-center justify-center rounded-sm border",
            selected ? "border-current" : "border-muted-foreground/60",
          )}
        >
          {selected && <CheckMark />}
        </span>
        {selected ? "Selected" : "Select"}
      </button>

      {total > 1 && (
        <>
          <StepButton side="left" disabled={index === 0} onClick={() => onStep(-1)} />
          <StepButton
            side="right"
            disabled={index === total - 1}
            onClick={() => onStep(1)}
          />
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t bg-background/80 px-3 py-2 text-xs">
        <span className="min-w-0 truncate font-medium">{item.filename}</span>
        <span className="shrink-0 text-muted-foreground">
          {formatAttachmentSize(item.size)} · {formatDate(item.uploadedAt)} ·{" "}
          {index + 1}/{total}
        </span>
      </div>
    </div>
  );
}

function StepButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous image" : "Next image"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm ring-1 ring-foreground/10 transition-colors hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50",
        side === "left" ? "left-2" : "right-2",
        // Kept in the layout rather than hidden, so the controls don't shift
        // as you reach either end.
        disabled && "pointer-events-none opacity-30",
      )}
    >
      {side === "left" ? (
        <ChevronLeftIcon className="size-5" />
      ) : (
        <ChevronRightIcon className="size-5" />
      )}
    </button>
  );
}
