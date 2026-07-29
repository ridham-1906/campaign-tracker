"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  formatDate,
  lifecycleState,
  toDateInputValue,
} from "@/lib/campaign";
import {
  useCampaignStatsQuery,
  useCampaignsQuery,
  useDeleteCampaign,
  useSaveCampaign,
  useSendReminder,
} from "@/lib/queries/campaigns";
import { useEntityOptions } from "@/lib/queries/entities";
import { StatusBadge } from "@/components/status-badge";
import { useConfirm } from "@/components/use-confirm";
import {
  CampaignForm,
  emptyCampaign,
  type CampaignDraft,
  type LocationDraft,
} from "@/components/campaign-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTable,
  sortParams,
  useTableState,
} from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CampaignListLocationView,
  CampaignListView,
  CampaignStatusFilter,
} from "@/lib/view-types";

export type LocationRow = CampaignListLocationView;
export type CampaignRow = CampaignListView;

/** A location satisfies the `{status, endDate}` shape the helpers expect. */
function stateOf(l: LocationRow) {
  return lifecycleState({ status: l.status, endDate: new Date(l.endDate) });
}

/**
 * Campaign-level rollups over the locations. These still run on the client for
 * per-row rendering; the equivalent predicates for filtering and for the stat
 * tiles live in statusFilters() in lib/data.ts, expressed as $elemMatch.
 */
const anyLive = (c: CampaignRow) => c.locations.some((l) => stateOf(l) === "LIVE");
const allEnded = (c: CampaignRow) =>
  c.locations.length > 0 && c.locations.every((l) => stateOf(l) === "ENDED");

/** Soonest end date across the campaign — what the list is ordered by. */
function earliestEnd(c: CampaignRow) {
  return Math.min(...c.locations.map((l) => new Date(l.endDate).getTime()));
}

function latestEnd(c: CampaignRow) {
  return Math.max(...c.locations.map((l) => new Date(l.endDate).getTime()));
}

function earliestStart(c: CampaignRow) {
  return Math.min(...c.locations.map((l) => new Date(l.startDate).getTime()));
}

function toDraft(c: CampaignRow): CampaignDraft {
  return {
    clientId: c.client.id,
    salesId: c.sales.id,
    locations: c.locations.map(
      (l): LocationDraft => ({
        id: l.id,
        city: l.city,
        location: l.location,
        type: l.type,
        vendorId: l.vendor.id,
        startDate: toDateInputValue(l.startDate),
        midDate: l.midDate ? toDateInputValue(l.midDate) : "",
        endDate: toDateInputValue(l.endDate),
        status: l.status,
      }),
    ),
  };
}

export function CampaignManager() {
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign);
  const [statusFilter, setStatusFilter] = useState<CampaignStatusFilter>("all");

  const table = useTableState();

  // Filtering and paging now happen in the database, so the status filter is
  // part of the query key rather than a useMemo over a fully-loaded array.
  const query = useCampaignsQuery({
    page: table.pagination.pageIndex + 1,
    limit: table.pagination.pageSize,
    q: table.debouncedSearch || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    ...sortParams(table.sorting),
  });

  // Totals across the whole result set — they can't be derived from one page.
  const statsQuery = useCampaignStatsQuery(table.debouncedSearch || undefined);
  const stats = statsQuery.data;

  const saveCampaign = useSaveCampaign();
  const deleteCampaign = useDeleteCampaign();
  const sendReminderMutation = useSendReminder();

  // Only needed to tell an empty list "add a client first" from "no matches",
  // and both lists are already cached for the form's comboboxes.
  const { data: clientOptions = [] } = useEntityOptions("clients");
  const { data: salesOptions = [] } = useEntityOptions("sales");
  const missingRefs = clientOptions.length === 0 || salesOptions.length === 0;

  const campaigns = query.data?.rows ?? [];

  function setFilter(next: CampaignStatusFilter) {
    setStatusFilter(next);
    // The new filter has its own row count, so any offset into the old one is
    // meaningless.
    table.toFirstPage();
  }

  function openAdd() {
    setEditingId(null);
    setDraft(emptyCampaign());
    setOpen(true);
  }

  const openEdit = useCallback((c: CampaignRow) => {
    setEditingId(c.id);
    setDraft(toDraft(c));
    setOpen(true);
  }, []);

  function save() {
    saveCampaign.mutate(
      {
        id: editingId,
        payload: {
          clientId: draft.clientId,
          salesId: draft.salesId,
          locations: draft.locations.map((l) => ({
            ...(l.id ? { id: l.id } : {}),
            city: l.city,
            location: l.location,
            type: l.type,
            vendorId: l.vendorId,
            startDate: l.startDate,
            midDate: l.midDate,
            endDate: l.endDate,
            status: l.status,
          })),
        },
      },
      // Closing the dialog is a local UI concern, so it stays here — and only
      // fires on success, leaving the form intact if the write failed.
      { onSuccess: () => setOpen(false) },
    );
  }

  /** Omit `locationId` to send one digest covering every live location. */
  const sendReminder = useCallback(
    (c: CampaignRow, locationId?: string) => {
      sendReminderMutation.mutate({
        campaignId: c.id,
        locationId,
        recipient: c.sales.email ?? c.sales.name,
      });
    },
    [sendReminderMutation],
  );

  const remove = useCallback(
    async (c: CampaignRow) => {
      const ok = await confirm({
        title: "Delete campaign?",
        description: `The ${c.client.name} campaign and all ${c.locations.length} of its locations will be permanently deleted.`,
        confirmLabel: "Delete campaign",
      });
      if (!ok) return;
      deleteCampaign.mutate(c.id);
    },
    [confirm, deleteCampaign],
  );

  const columns = useMemo<ColumnDef<CampaignRow>[]>(
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
        id: "locations",
        // The search term now goes to the server, which matches it against
        // every location's name, city, type and vendor — see buildSearch()
        // in lib/data.ts.
        header: "Locations",
        enableSorting: false,
        cell: ({ row }) => {
          const n = row.original.locations.length;
          return (
            <span>
              {n} location{n === 1 ? "" : "s"}
            </span>
          );
        },
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
        id: "endDate",
        header: "Next to end",
        cell: ({ row }) => {
          const left = daysUntil(new Date(earliestEnd(row.original)));
          const ended = allEnded(row.original);
          return (
            <span
              className={
                ended ? "text-muted-foreground" : left <= 7 ? "text-amber-600" : ""
              }
            >
              {ended ? "—" : left < 0 ? `${Math.abs(left)}d ago` : `${left}d`}
            </span>
          );
        },
      },
      {
        id: "status",
        header: "Status",
        // Filtered via the stat tiles, which query the server.
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original;
          const live = c.locations.filter((l) => stateOf(l) === "LIVE").length;
          const pending = c.locations.filter(
            (l) => stateOf(l) === "PENDING_CREATIVE",
          ).length;
          const ended = c.locations.length - live - pending;
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
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { className: "w-0 text-right" },
        cell: ({ row }) => (
          <RowActions>
            <DropdownMenuItem
              disabled={!anyLive(row.original)}
              onClick={() => sendReminder(row.original)}
            >
              Send reminder (all live)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEdit(row.original)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => remove(row.original)}
            >
              Delete
            </DropdownMenuItem>
          </RowActions>
        ),
      },
    ],
    [openEdit, remove, sendReminder],
  );

  const renderLocations = useCallback(
    (c: CampaignRow) => (
      <div className="px-4 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Location</th>
              <th className="pb-2 pr-4 font-medium">City</th>
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
            {c.locations.map((l) => {
              const left = daysUntil(new Date(l.endDate));
              const ended = stateOf(l) === "ENDED";
              return (
                <tr
                  key={l.id}
                  className={cn("border-t", ended && "text-muted-foreground")}
                >
                  <td className="py-2 pr-4">{l.location}</td>
                  <td className="py-2 pr-4">{l.city}</td>
                  <td className="py-2 pr-4">{l.type}</td>
                  <td className="py-2 pr-4">{l.vendor.name}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {formatDate(l.startDate)}
                  </td>
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
                  <td className="py-2 text-right">
                    <RowActions>
                      <DropdownMenuItem
                        disabled={ended}
                        onClick={() => sendReminder(c, l.id)}
                      >
                        Send reminder
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        Edit campaign
                      </DropdownMenuItem>
                    </RowActions>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ),
    [openEdit, sendReminder],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Track status and reminders across all your campaigns.
          </p>
        </div>
        <Button onClick={openAdd}>+ New campaign</Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Total"
          value={stats?.total}
          active={statusFilter === "all"}
          onClick={() => setFilter("all")}
        />
        <Stat
          label="Live"
          value={stats?.live}
          active={statusFilter === "LIVE"}
          onClick={() => setFilter(statusFilter === "LIVE" ? "all" : "LIVE")}
        />
        <Stat
          label="Expiring soon"
          value={stats?.expiring}
          accent="amber"
          active={statusFilter === "EXPIRING"}
          onClick={() =>
            setFilter(statusFilter === "EXPIRING" ? "all" : "EXPIRING")
          }
        />
        <Stat
          label="Ended"
          value={stats?.ended}
          active={statusFilter === "ENDED"}
          onClick={() => setFilter(statusFilter === "ENDED" ? "all" : "ENDED")}
        />
        <Stat
          label="Creative reminders today"
          value={stats?.creativePending}
          accent="blue"
          active={statusFilter === "CREATIVE"}
          onClick={() =>
            setFilter(statusFilter === "CREATIVE" ? "all" : "CREATIVE")
          }
        />
        <Stat
          label="Reminders sent today"
          value={stats?.sentToday}
          active={statusFilter === "SENT_TODAY"}
          onClick={() =>
            setFilter(statusFilter === "SENT_TODAY" ? "all" : "SENT_TODAY")
          }
        />
      </div>

      <Card className="min-h-0 flex-1">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <DataTable
            columns={columns}
            data={campaigns}
            rowCount={query.data?.total ?? 0}
            pagination={table.pagination}
            onPaginationChange={table.setPagination}
            sorting={table.sorting}
            onSortingChange={table.setSorting}
            search={table.search}
            onSearchChange={table.setSearch}
            isLoading={query.isLoading}
            isFetching={query.isFetching}
            renderExpanded={renderLocations}
            searchPlaceholder="Search client, sales, location, city, vendor…"
            empty={
              statusFilter === "all" ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    No campaigns yet.
                    {missingRefs && " Add a client and a sales person first."}
                  </p>
                  {missingRefs ? (
                    <div className="flex gap-2 text-sm">
                      <Link href="/clients" className="underline">
                        Clients
                      </Link>
                      <Link href="/sales" className="underline">
                        Sales
                      </Link>
                    </div>
                  ) : (
                    <Button onClick={openAdd}>+ New campaign</Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    No campaigns{" "}
                    {statusFilter === "EXPIRING"
                      ? "expiring soon"
                      : statusFilter === "SENT_TODAY"
                        ? "with a reminder sent today"
                        : statusFilter === "CREATIVE"
                          ? "with creative still pending"
                          : `that are ${statusFilter.toLowerCase()}`}
                    .
                  </p>
                  <Button variant="outline" onClick={() => setFilter("all")}>
                    Clear filter
                  </Button>
                </div>
              )
            }
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit campaign" : "New campaign"}
            </DialogTitle>
          </DialogHeader>

          <CampaignForm
            key={editingId ?? "new"}
            draft={draft}
            setDraft={setDraft}
            editing={Boolean(editingId)}
            saving={saveCampaign.isPending}
            onSubmit={save}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  /** Undefined while the counts query is still in flight. */
  value: number | undefined;
  accent?: "amber" | "blue";
  active?: boolean;
  onClick?: () => void;
}) {
  const accentClass =
    accent === "amber" ? "text-amber-600" : accent === "blue" ? "text-blue-600" : "";
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
      <p className={cn("text-lg font-semibold", accentClass)}>
        {value ?? "—"}
      </p>
    </button>
  );
}
