"use client";

import Link from "next/link";
import { lifecycleState } from "@/lib/campaign";
import { useDashboardQuery } from "@/lib/queries/dashboard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignListLocationView } from "@/lib/view-types";

function stateOf(l: CampaignListLocationView) {
  return lifecycleState({ status: l.status, endDate: new Date(l.endDate) });
}

/**
 * The campaigns a sales person is assigned to — opened from the "N campaigns"
 * badge on the Sales persons screen. Reads `/api/dashboard` (every user's
 * campaigns, filtered to this sales person) rather than `/api/campaigns`,
 * since a sales person can be on campaigns belonging to more than one backend
 * user — hence the Backend column.
 */
export function SalesCampaignsDialog({
  salesPerson,
  onClose,
}: {
  salesPerson: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const query = useDashboardQuery(
    { salesId: salesPerson?.id, page: 1, limit: 100 },
    { enabled: Boolean(salesPerson) },
  );
  const rows = query.data?.rows ?? [];

  return (
    <Dialog
      open={salesPerson !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{salesPerson?.name}&apos;s campaigns</DialogTitle>
        </DialogHeader>

        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No campaigns assigned.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto thin-scrollbar">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Client</th>
                  <th className="pb-2 pr-4 font-medium">Sales</th>
                  <th className="pb-2 pr-4 font-medium">Locations</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 font-medium">Backend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const live = c.locations.filter((l) => stateOf(l) === "LIVE").length;
                  const pending = c.locations.filter(
                    (l) => stateOf(l) === "PENDING_CREATIVE",
                  ).length;
                  const ended = c.locations.length - live - pending;
                  return (
                    <tr key={c.id} className="border-t">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/campaigns/${c.id}`}
                          onClick={onClose}
                          className="font-medium hover:underline"
                        >
                          {c.client.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{c.sales.name}</td>
                      <td className="py-2 pr-4">
                        {c.locations.length} location
                        {c.locations.length === 1 ? "" : "s"}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          {live > 0 && (
                            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              {live} live
                            </span>
                          )}
                          {pending > 0 && (
                            <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                              {pending} pending
                            </span>
                          )}
                          {ended > 0 && (
                            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {ended} ended
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {c.owner?.name ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
