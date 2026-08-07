"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { formatDate, lifecycleState } from "@/lib/campaign";
import {
  useDashboardQuery,
  useDashboardStatsQuery,
} from "@/lib/queries/dashboard";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTable,
  sortParams,
  useTableState,
} from "@/components/ui/data-table";
import type { CampaignListView, CampaignStatusFilter } from "@/lib/view-types";

type Row = CampaignListView;

/** The campaign's overall run — earliest start to latest end across locations. */
function earliestStart(c: Row) {
  return Math.min(...c.locations.map((l) => new Date(l.startDate).getTime()));
}

function latestEnd(c: Row) {
  return Math.max(...c.locations.map((l) => new Date(l.endDate).getTime()));
}

/** Per-state location counts, the same rollup the Campaigns table shows. */
function stateCounts(c: Row) {
  const live = c.locations.filter(
    (l) => lifecycleState({ status: l.status, endDate: new Date(l.endDate) }) === "LIVE",
  ).length;
  const pending = c.locations.filter(
    (l) =>
      lifecycleState({ status: l.status, endDate: new Date(l.endDate) }) ===
      "PENDING_CREATIVE",
  ).length;
  return { live, pending, ended: c.locations.length - live - pending };
}

/**
 * The shared dashboard: every user's campaigns, read-only, at a glance.
 *
 * Distinct from the Campaigns screen, which is owner-scoped and is where
 * campaigns are actually created and edited. This one answers "what is the team
 * running right now" — hence the Backend column naming who owns each row, which
 * only means anything because the list is *not* filtered to the viewer.
 */
export function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");
  const table = useTableState();

  const query = useDashboardQuery({
    page: table.pagination.pageIndex + 1,
    limit: table.pagination.pageSize,
    q: table.debouncedSearch || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    ...sortParams(table.sorting),
  });

  // Totals across the whole result set — they can't be derived from one page.
  const stats = useDashboardStatsQuery(table.debouncedSearch || undefined).data;

  function setFilter(next: CampaignStatusFilter) {
    setStatusFilter(next);
    // The new filter has its own row count, so any offset into the old one is
    // meaningless.
    table.toFirstPage();
  }

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "client",
        accessorFn: (c) => c.client.name,
        header: "Client",
        cell: ({ getValue }) => (
          <span className="font-medium">{getValue<string>()}</span>
        ),
      },
      {
        id: "sales",
        accessorFn: (c) => c.sales.name,
        header: "Sales",
      },
      {
        // Sort ids match CAMPAIGN_SORT_KEYS in lib/data.ts — the server orders
        // by the min/max across each campaign's locations.
        id: "dates",
        header: "Runs",
        cell: ({ row }) => (
          <span>
            {formatDate(new Date(earliestStart(row.original)))} –{" "}
            {formatDate(new Date(latestEnd(row.original)))}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        // Filtered via the stat tiles, which query the server.
        enableSorting: false,
        cell: ({ row }) => {
          const { live, pending, ended } = stateCounts(row.original);
          return (
            <span className="flex items-center gap-1.5">
              {live > 0 && (
                <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {live} live
                </span>
              )}
              {pending > 0 && (
                <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                  {pending} pending creative
                </span>
              )}
              {ended > 0 && (
                <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {ended} ended
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "backend",
        // The owning user — always resolved on this endpoint, since the list
        // spans everyone.
        accessorFn: (c) => c.owner?.name ?? "—",
        header: "Backend",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue<string>()}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Every campaign across the team, live and ended.
        </p>
      </div>

      {/* Both tiles toggle: clicking the active one clears back to every
          campaign, which is the only way back without a Total tile. */}
      <div className="grid shrink-0 grid-cols-2 gap-3">
        <Stat
          label="Live"
          value={stats?.live}
          active={statusFilter === "LIVE"}
          onClick={() => setFilter(statusFilter === "LIVE" ? "all" : "LIVE")}
        />
        <Stat
          label="Ended"
          value={stats?.ended}
          active={statusFilter === "ENDED"}
          onClick={() => setFilter(statusFilter === "ENDED" ? "all" : "ENDED")}
        />
      </div>

      <Card className="min-h-0 flex-1">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <DataTable
            columns={columns}
            data={query.data?.rows ?? []}
            rowCount={query.data?.total ?? 0}
            pagination={table.pagination}
            onPaginationChange={table.setPagination}
            sorting={table.sorting}
            onSortingChange={table.setSorting}
            search={table.search}
            onSearchChange={table.setSearch}
            searchPlaceholder="Search client, sales, location…"
            isLoading={query.isLoading}
            isFetching={query.isFetching}
            empty={
              <p className="p-8 text-center text-sm text-muted-foreground">
                {table.debouncedSearch || statusFilter !== "all"
                  ? "No campaigns match."
                  : "No campaigns yet."}
              </p>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  /** Undefined while the counts query is still in flight. */
  value: number | undefined;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl bg-card px-3.5 py-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "ring-1 ring-black/30 hover:bg-card",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value ?? "—"}</p>
    </button>
  );
}
