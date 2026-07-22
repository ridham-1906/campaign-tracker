import { Badge } from "@/components/ui/badge";
import { lifecycleLabel, lifecycleState } from "@/lib/campaign";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  endDate,
}: {
  status: string;
  endDate: string | Date;
}) {
  const state = lifecycleState({ status, endDate: new Date(endDate) });
  return (
    <Badge
      variant="secondary"
      className={cn(
        "border-0 font-medium",
        state === "LIVE"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : state === "PENDING_CREATIVE"
            ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
            : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      )}
    >
      {lifecycleLabel(state)}
    </Badge>
  );
}
