import { Loader2Icon } from "lucide-react";

/**
 * Covers the brief server render of every (app) route. The list data itself
 * loads client-side and shows its own in-table state, so this only bridges
 * the session check.
 */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
