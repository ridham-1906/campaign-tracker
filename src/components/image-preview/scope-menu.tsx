"use client";

import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** What a Download/Delete menu pick applies to. */
export type Scope = "current" | "selected" | "all";

/**
 * One action button that asks what to apply itself to. Counts live in the
 * labels so the choice is made in the menu, not guessed from the button.
 */
export function ScopeMenu({
  label,
  icon,
  variant,
  disabled,
  hasCurrent,
  selectedCount,
  totalCount,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  variant: "outline" | "destructive";
  disabled: boolean;
  hasCurrent: boolean;
  selectedCount: number;
  totalCount: number;
  onPick: (scope: Scope) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant={variant} size="sm" disabled={disabled} />
        }
      >
        {icon}
        {label}
        <ChevronDownIcon className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          disabled={!hasCurrent}
          onClick={() => onPick("current")}
        >
          Current image
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={selectedCount === 0}
          onClick={() => onPick("selected")}
        >
          Selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={totalCount === 0}
          onClick={() => onPick("all")}
        >
          All{totalCount > 0 ? ` (${totalCount})` : ""}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
