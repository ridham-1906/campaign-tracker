"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { apiError, apiFetch } from "@/lib/http";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  formatDate,
  isExpiringSoon,
  lifecycleState,
  startOfDay,
  toDateInputValue,
} from "@/lib/campaign";
import { StatusBadge } from "@/components/status-badge";
import { useConfirm } from "@/components/use-confirm";
import {
  CampaignForm,
  emptyCampaign,
  effectiveReminder,
  type CampaignDraft,
  type FormOptions,
  type LocationDraft,
} from "@/components/campaign-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AttachmentRow } from "@/components/location-attachments-editor";

type Person = { id: string; name: string; email?: string };

export type LocationRow = {
  id: string;
  city: string;
  location: string;
  type: string;
  days: number;
  status: string;
  vendor: Person;
  startDate: string;
  endDate: string;
  reminder: { date: string; sent: boolean; sentAt: string | null };
  attachments: AttachmentRow[];
};

export type CampaignRow = {
  id: string;
  client: Person;
  sales: Person;
  locations: LocationRow[];
};

/** A location satisfies the `{status, endDate}` shape the helpers expect. */
function stateOf(l: LocationRow) {
  return lifecycleState({ status: l.status, endDate: new Date(l.endDate) });
}

function expiringSoon(l: LocationRow) {
  return isExpiringSoon({ status: l.status, endDate: new Date(l.endDate) });
}

function sentToday(l: LocationRow) {
  if (!l.reminder.sent || !l.reminder.sentAt) return false;
  return (
    startOfDay(new Date(l.reminder.sentAt)).getTime() ===
    startOfDay(new Date()).getTime()
  );
}

// Campaign-level rollups over the locations.
const anyLive = (c: CampaignRow) => c.locations.some((l) => stateOf(l) === "LIVE");
const allEnded = (c: CampaignRow) =>
  c.locations.length > 0 && c.locations.every((l) => stateOf(l) === "ENDED");
const anyExpiring = (c: CampaignRow) => c.locations.some(expiringSoon);
const anySentToday = (c: CampaignRow) => c.locations.some(sentToday);

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
        endDate: toDateInputValue(l.endDate),
        reminderDate: toDateInputValue(l.reminder.date),
        // Existing reminders keep their stored date rather than snapping back
        // to end-minus-lead when the form opens.
        reminderTouched: true,
        status: l.status,
      }),
    ),
  };
}

export function CampaignManager({
  campaigns,
  options,
}: {
  campaigns: CampaignRow[];
  options: FormOptions;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(emptyCampaign);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "LIVE" | "EXPIRING" | "ENDED" | "SENT_TODAY"
  >("all");

  const missingRefs =
    options.clients.length === 0 || options.sales.length === 0;

  const stats = useMemo(() => {
    const live = campaigns.filter(anyLive).length;
    return {
      total: campaigns.length,
      live,
      ended: campaigns.filter(allEnded).length,
      expiring: campaigns.filter(anyExpiring).length,
      sentToday: campaigns.filter(anySentToday).length,
    };
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    switch (statusFilter) {
      case "LIVE":
        return campaigns.filter(anyLive);
      case "ENDED":
        return campaigns.filter(allEnded);
      case "EXPIRING":
        return campaigns.filter(anyExpiring);
      case "SENT_TODAY":
        return campaigns.filter(anySentToday);
      default:
        return campaigns;
    }
  }, [campaigns, statusFilter]);

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

  async function save() {
    setSaving(true);
    const payload = JSON.stringify({
      clientId: draft.clientId,
      salesId: draft.salesId,
      locations: draft.locations.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        city: l.city,
        location: l.location,
        type: l.type,
        vendorId: l.vendorId,
        startDate: l.startDate,
        endDate: l.endDate,
        reminderDate: effectiveReminder(l) || undefined,
        status: l.status,
      })),
    });
    const res = editingId
      ? await apiFetch(`/api/campaigns/${editingId}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch(`/api/campaigns`, { method: "POST", body: payload });
    setSaving(false);
    if (!res.ok) return toast.error(apiError(res.data));
    toast.success(`Campaign ${editingId ? "updated" : "created"}`);
    setOpen(false);
    router.refresh();
  }

  /** Omit `locationId` to send one digest covering every live location. */
  const sendReminder = useCallback(
    async (c: CampaignRow, locationId?: string) => {
      const res = await apiFetch<{ locations: number }>(
        `/api/campaigns/${c.id}/send-reminder`,
        {
          method: "POST",
          body: JSON.stringify(locationId ? { locationId } : {}),
        },
      );
      if (!res.ok) return toast.error(apiError(res.data, "Failed to send"));
      const n = res.data?.locations ?? 1;
      toast.success(
        `Reminder for ${n} location${n === 1 ? "" : "s"} sent to ${
          c.sales.email ?? c.sales.name
        }`,
      );
      router.refresh();
    },
    [router],
  );

  const remove = useCallback(
    async (c: CampaignRow) => {
      const ok = await confirm({
        title: "Delete campaign?",
        description: `The ${c.client.name} campaign and all ${c.locations.length} of its locations will be permanently deleted.`,
        confirmLabel: "Delete campaign",
      });
      if (!ok) return;
      const res = await apiFetch(`/api/campaigns/${c.id}`, { method: "DELETE" });
      if (!res.ok) return toast.error(apiError(res.data));
      toast.success("Campaign deleted");
      router.refresh();
    },
    [router, confirm],
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
        // Searchable by any of its locations' names, cities and vendors.
        accessorFn: (c) =>
          c.locations
            .map((l) => `${l.location} ${l.city} ${l.type} ${l.vendor.name}`)
            .join(" "),
        header: "Locations",
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
        id: "dates",
        accessorFn: (c) => earliestStart(c),
        header: "Runs",
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <span>
            {formatDate(new Date(earliestStart(row.original)))} –{" "}
            {formatDate(new Date(latestEnd(row.original)))}
          </span>
        ),
      },
      {
        id: "endDate",
        accessorFn: (c) => earliestEnd(c),
        header: "Next to end",
        enableGlobalFilter: false,
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
        accessorFn: (c) => (allEnded(c) ? "ENDED" : "LIVE"),
        header: "Status",
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
        enableGlobalFilter: false,
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
              <th className="pb-2 pr-4 font-medium">Reminder</th>
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
                        ? `Sent ${formatDate(l.reminder.sentAt ?? l.reminder.date)}`
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

      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Total"
          value={stats.total}
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <Stat
          label="Live"
          value={stats.live}
          active={statusFilter === "LIVE"}
          onClick={() => setStatusFilter((f) => (f === "LIVE" ? "all" : "LIVE"))}
        />
        <Stat
          label="Expiring soon"
          value={stats.expiring}
          accent="amber"
          active={statusFilter === "EXPIRING"}
          onClick={() =>
            setStatusFilter((f) => (f === "EXPIRING" ? "all" : "EXPIRING"))
          }
        />
        <Stat
          label="Ended"
          value={stats.ended}
          active={statusFilter === "ENDED"}
          onClick={() => setStatusFilter((f) => (f === "ENDED" ? "all" : "ENDED"))}
        />
        <Stat
          label="Reminders sent today"
          value={stats.sentToday}
          active={statusFilter === "SENT_TODAY"}
          onClick={() =>
            setStatusFilter((f) => (f === "SENT_TODAY" ? "all" : "SENT_TODAY"))
          }
        />
      </div>

      <Card className="min-h-0 flex-1">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <DataTable
            columns={columns}
            data={filteredCampaigns}
            renderExpanded={renderLocations}
            searchPlaceholder="Search client, sales, location, city, vendor…"
            empty={
              campaigns.length === 0 ? (
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
                        : `that are ${statusFilter.toLowerCase()}`}
                    .
                  </p>
                  <Button variant="outline" onClick={() => setStatusFilter("all")}>
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
            options={options}
            editing={Boolean(editingId)}
            saving={saving}
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
  value: number;
  accent?: "amber";
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
      <p
        className={`text-lg font-semibold ${accent === "amber" ? "text-amber-600" : ""}`}
      >
        {value}
      </p>
    </button>
  );
}
