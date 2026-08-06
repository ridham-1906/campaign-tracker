"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  addDays,
  businessToday,
  daysUntil,
  formatDate,
  lifecycleState,
  startOfDay,
  toDateInputValue,
} from "@/lib/campaign";
import {
  useCampaignStatsQuery,
  useCampaignsQuery,
  useDeleteCampaign,
  useRenewCampaign,
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
  type CampaignFormMode,
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

/** Dimensions are numbers on the wire and `<Input>` strings in the draft. */
function sizeText(v: number | null) {
  return v == null ? "" : String(v);
}

function toDraft(c: CampaignRow): CampaignDraft {
  return {
    clientId: c.client.id,
    salesId: c.sales.id,
    category: c.category,
    locations: c.locations.map(
      (l): LocationDraft => ({
        id: l.id,
        city: l.city,
        location: l.location,
        medium: l.medium,
        type: l.type,
        width: sizeText(l.width),
        height: sizeText(l.height),
        sqft: sizeText(l.sqft),
        vendorId: l.vendor.id,
        startDate: toDateInputValue(l.startDate),
        midDate: l.midDate ? toDateInputValue(l.midDate) : "",
        endDate: toDateInputValue(l.endDate),
        status: l.status,
      }),
    ),
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * A renewal moves the *same* campaign into its next booking term — it does not
 * write a second one. Location ids are therefore kept, not dropped: the server
 * archives the outgoing dates against those ids, and every photo already
 * uploaded stays on the campaign, tagged with the term it was taken under.
 *
 * Each location is shifted on its own, keeping its original length, so a
 * campaign whose placements ran to different end dates renews as the same
 * staggered set rather than being flattened onto one term. The new term starts
 * the day after the old one ended — or today, if that has already passed, so
 * renewing a long-expired campaign never proposes dates in the past.
 *
 * Every status resets to LIVE: a renewal is a fresh booking, not a
 * continuation of whatever state the last one finished in.
 */
function renewalDraft(c: CampaignRow): CampaignDraft {
  const today = businessToday();

  return {
    clientId: c.client.id,
    salesId: c.sales.id,
    category: c.category,
    locations: c.locations.map((l): LocationDraft => {
      const oldStart = startOfDay(new Date(l.startDate));
      const oldEnd = startOfDay(new Date(l.endDate));
      const start = new Date(
        Math.max(addDays(oldEnd, 1).getTime(), today.getTime()),
      );
      const shift = Math.round((start.getTime() - oldStart.getTime()) / MS_PER_DAY);

      return {
        id: l.id,
        city: l.city,
        location: l.location,
        medium: l.medium,
        type: l.type,
        width: sizeText(l.width),
        height: sizeText(l.height),
        sqft: sizeText(l.sqft),
        vendorId: l.vendor.id,
        startDate: toDateInputValue(start),
        midDate: l.midDate
          ? toDateInputValue(addDays(startOfDay(new Date(l.midDate)), shift))
          : "",
        endDate: toDateInputValue(addDays(oldEnd, shift)),
        status: "LIVE",
      };
    }),
  };
}

export function CampaignManager({
  isAdmin = false,
  currentUserId,
}: {
  /** True for an ADMIN_EMAILS account — every user's campaigns show up here,
   * with an Owner column, but only the admin's own rows stay editable. */
  isAdmin?: boolean;
  currentUserId?: string;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<CampaignFormMode>("create");
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign);
  // Bumped on every open so the form remounts with fresh step state, even when
  // the same campaign is reopened or two renewals are started back to back.
  const [formNonce, setFormNonce] = useState(0);
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
  const renewCampaign = useRenewCampaign();
  const deleteCampaign = useDeleteCampaign();
  const sendReminderMutation = useSendReminder();

  // Only needed to tell an empty list "add a client first" from "no matches",
  // and both lists are already cached for the form's comboboxes.
  const { data: clientOptions = [] } = useEntityOptions("clients");
  const { data: salesOptions = [] } = useEntityOptions("sales");
  const missingRefs = clientOptions.length === 0 || salesOptions.length === 0;

  const campaigns = query.data?.rows ?? [];

  // `owner` is only ever populated for an admin's all-users query — a normal
  // user's rows never carry one, so this is always true for them.
  const isOwn = useCallback(
    (c: CampaignRow) => !c.owner || c.owner.id === currentUserId,
    [currentUserId],
  );

  function setFilter(next: CampaignStatusFilter) {
    setStatusFilter(next);
    // The new filter has its own row count, so any offset into the old one is
    // meaningless.
    table.toFirstPage();
  }

  function openAdd() {
    setEditingId(null);
    setMode("create");
    setDraft(emptyCampaign());
    setFormNonce((n) => n + 1);
    setOpen(true);
  }

  const openEdit = useCallback((c: CampaignRow) => {
    setEditingId(c.id);
    setMode("edit");
    setDraft(toDraft(c));
    setFormNonce((n) => n + 1);
    setOpen(true);
  }, []);

  /** Roll the campaign into its next term, in place — see renewalDraft(). */
  const openRenew = useCallback((c: CampaignRow) => {
    // The id is kept: a renewal updates this campaign rather than writing a
    // second one, so its photos and history stay with it.
    setEditingId(c.id);
    setMode("renew");
    setDraft(renewalDraft(c));
    setFormNonce((n) => n + 1);
    setOpen(true);
  }, []);

  /** The location fields as both endpoints want them. */
  function locationPayload(l: LocationDraft) {
    return {
      ...(l.id ? { id: l.id } : {}),
      city: l.city,
      location: l.location,
      medium: l.medium,
      // Sent as the raw input strings — the API's zod schema coerces them and
      // turns "" into "not set" rather than 0.
      type: l.type,
      width: l.width,
      height: l.height,
      sqft: l.sqft,
      vendorId: l.vendorId,
      startDate: l.startDate,
      midDate: l.midDate,
      endDate: l.endDate,
      status: l.status,
    };
  }

  // Closing the dialog is a local UI concern, so it stays here — and only
  // fires on success, leaving the form intact if the write failed.
  const closeOnSuccess = { onSuccess: () => setOpen(false) };

  function save() {
    const locations = draft.locations.map(locationPayload);

    // A renewal is neither a create nor a PATCH: it archives the current term
    // and restarts the reminder series, and it must not apply PATCH's
    // "anything omitted is deleted" rule to locations that weren't rebooked.
    if (mode === "renew" && editingId) {
      renewCampaign.mutate({ id: editingId, locations }, closeOnSuccess);
      return;
    }

    saveCampaign.mutate(
      {
        id: editingId,
        payload: {
          clientId: draft.clientId,
          salesId: draft.salesId,
          category: draft.category,
          locations,
        },
      },
      closeOnSuccess,
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
      ...(isAdmin
        ? [
            {
              id: "owner",
              accessorFn: (c: CampaignRow) => c.owner?.name ?? "",
              header: "Owner",
            } satisfies ColumnDef<CampaignRow>,
          ]
        : []),
      {
        id: "client",
        accessorFn: (c) => c.client.name,
        header: "Client",
        cell: ({ row, getValue }) => (
          <span className="flex items-center gap-1.5">
            <span className="font-medium">{getValue<string>()}</span>
            {/* Only worth the space once a campaign has actually been renewed. */}
            {row.original.term > 1 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Term {row.original.term}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "sales",
        accessorFn: (c) => c.sales.name,
        header: "Sales",
      },
      {
        id: "category",
        accessorFn: (c) => c.category,
        header: "Category",
        enableSorting: false,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {getValue<string>() || "—"}
          </span>
        ),
      },
      {
        id: "locations",
        // The search term now goes to the server, which matches it against the
        // campaign's category and every location's name, city, medium, type and
        // vendor — see buildSearch() in lib/data.ts.
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
        cell: ({ row }) => {
          // An admin can only manage their own campaigns — another user's row
          // shows no actions at all, matching the view-only scope.
          if (!isOwn(row.original)) return null;
          return (
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
              <DropdownMenuItem onClick={() => openRenew(row.original)}>
                Renew
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => remove(row.original)}
              >
                Delete
              </DropdownMenuItem>
            </RowActions>
          );
        },
      },
    ],
    [isAdmin, isOwn, openEdit, openRenew, remove, sendReminder],
  );

  const renderLocations = useCallback(
    (c: CampaignRow) => (
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
                  <td className="py-2 pr-4">{l.medium}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {l.width ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {l.height ?? "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {l.sqft ?? "—"}
                  </td>
                  <td className="py-2 pr-4">{l.type || "—"}</td>
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
                    {isOwn(c) && (
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ),
    [isOwn, openEdit, sendReminder],
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
              {mode === "edit"
                ? "Edit campaign"
                : mode === "renew"
                  ? "Renew campaign"
                  : "New campaign"}
            </DialogTitle>
          </DialogHeader>

          <CampaignForm
            key={formNonce}
            draft={draft}
            setDraft={setDraft}
            mode={mode}
            saving={saveCampaign.isPending || renewCampaign.isPending}
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
