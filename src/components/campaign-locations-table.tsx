"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { daysUntil, formatDate, lifecycleState } from "@/lib/campaign";
import { StatusBadge } from "@/components/status-badge";
import type { CampaignListLocationView } from "@/lib/view-types";

/** A location satisfies the `{status, endDate}` shape the helpers expect. */
function stateOf(l: CampaignListLocationView) {
  return lifecycleState({ status: l.status, endDate: new Date(l.endDate) });
}

/** Live first, then pending creative, then ended — so a campaign's finished
 * sites sink to the bottom instead of sitting wherever they fall in storage
 * order. Stable otherwise: locations sharing a state keep their relative
 * order. */
const STATE_RANK = { LIVE: 0, PENDING_CREATIVE: 1, ENDED: 2 } as const;

function sortedByState(locations: CampaignListLocationView[]) {
  return [...locations].sort(
    (a, b) => STATE_RANK[stateOf(a)] - STATE_RANK[stateOf(b)],
  );
}

/**
 * One campaign's locations — shown on the campaign page.
 *
 * `actions` is the trailing per-location menu; the viewer only gets one for a
 * campaign they own, so a read-only view (an admin looking at someone else's)
 * passes nothing and the column stays empty.
 */
export function CampaignLocationsTable({
  locations,
  actions,
}: {
  locations: CampaignListLocationView[];
  actions?: (l: CampaignListLocationView) => ReactNode;
}) {
  return (
    <div className="px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Location</th>
            <th className="pb-2 pr-4 font-medium">City</th>
            <th className="pb-2 pr-4 font-medium">Medium</th>
            <th className="pb-2 pr-4 font-medium">W</th>
            <th className="pb-2 pr-4 font-medium">H</th>
            <th className="pb-2 pr-4 font-medium">SQFT</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium">Vendor</th>
            <th className="pb-2 pr-4 font-medium">Start</th>
            <th className="pb-2 pr-4 font-medium">End</th>
            <th className="pb-2 pr-4 font-medium">Days left</th>
            <th className="pb-2 pr-4 font-medium">Next reminder</th>
            <th className="pb-2 pr-4 font-medium">Status</th>
            <th className="pb-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {sortedByState(locations).map((l) => {
            const left = daysUntil(new Date(l.endDate));
            const ended = stateOf(l) === "ENDED";
            return (
              <tr
                key={l.id}
                className={cn("border-t", ended && "text-muted-foreground")}
              >
                <td className="py-2 pr-4">{l.location}</td>
                <td className="py-2 pr-4">{l.city}</td>
                <td className="py-2 pr-4">{l.medium}</td>
                <td className="py-2 pr-4">{l.width ?? "—"}</td>
                <td className="py-2 pr-4">{l.height ?? "—"}</td>
                <td className="py-2 pr-4">{l.sqft ?? "—"}</td>
                <td className="py-2 pr-4">{l.type || "—"}</td>
                <td className="py-2 pr-4">{l.vendor.name}</td>
                <td className="py-2 pr-4">{formatDate(l.startDate)}</td>
                <td className="py-2 pr-4">
                  {formatDate(l.endDate)}
                </td>
                <td
                  className={cn(
                    "py-2 pr-4",
                    ended
                      ? "text-muted-foreground"
                      : left <= 7
                        ? "text-amber-600"
                        : "",
                  )}
                >
                  {left < 0 ? `${Math.abs(left)}d ago` : `${left}d`}
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={cn(
                      "inline-flex rounded-md px-1.5 py-0.5 text-xs",
                      l.reminder.sent
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "text-muted-foreground",
                    )}
                  >
                    {l.reminder.sent
                      ? "Done"
                      : formatDate(l.reminder.date)}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <StatusBadge status={l.status} endDate={l.endDate} />
                </td>
                <td className="py-2 text-right">{actions?.(l)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
