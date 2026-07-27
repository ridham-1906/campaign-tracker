"use client";

import { cn } from "@/lib/utils";

/** Numbered breadcrumb for the multi-step dialogs. Completed steps are
 * clickable; steps ahead of the current one are not. */
export function StepNav({
  steps,
  current,
  onStep,
}: {
  steps: readonly string[];
  current: number;
  onStep: (index: number) => void;
}) {
  return (
    <ol className="flex shrink-0 items-center gap-2 text-xs">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => i < current && onStep(i)}
            disabled={i > current}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
              i === current
                ? "bg-primary text-primary-foreground"
                : i < current
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[10px] font-medium",
                i === current
                  ? "bg-primary-foreground text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            {label}
          </button>
          {i < steps.length - 1 && (
            <span className="text-muted-foreground/40">›</span>
          )}
        </li>
      ))}
    </ol>
  );
}
