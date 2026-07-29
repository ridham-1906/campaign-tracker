"use client";

import { ChevronDownIcon } from "lucide-react";
import {
  PHOTO_FILTERS,
  PHOTO_FILTER_LABELS,
  STAGE_FILTERS,
  STAGE_FILTER_LABELS,
  type PhotoFilter,
  type StageFilter,
} from "@/lib/attachments";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The stage → photo-type cascade shared by both "Export PPT" entry points
 * (the gallery's standalone button and the images table's row-action
 * submenu) — a stage picked first (matching the same Installation/Mid
 * date/End date choices the gallery's own Type filter offers), then which
 * photo type within that stage.
 */
export function ExportPptFilterItems({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (stage: StageFilter, photoFilter: PhotoFilter) => void;
}) {
  return (
    <>
      {STAGE_FILTERS.map((stage) => (
        <DropdownMenuSub key={stage}>
          <DropdownMenuSubTrigger>{STAGE_FILTER_LABELS[stage]}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {PHOTO_FILTERS.map((filter) => (
              <DropdownMenuItem
                key={filter}
                disabled={disabled}
                onClick={() => onPick(stage, filter)}
              >
                {PHOTO_FILTER_LABELS[filter]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ))}
    </>
  );
}

/** "Export PPT" as a standalone labeled button — for the location gallery,
 * where it sits alongside Download/Delete rather than inside an ellipsis menu. */
export function ExportPptButton({
  label,
  icon,
  disabled,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onPick: (stage: StageFilter, photoFilter: PhotoFilter) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
      >
        {icon}
        {label}
        <ChevronDownIcon className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <ExportPptFilterItems disabled={disabled} onPick={onPick} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
