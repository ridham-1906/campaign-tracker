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
import { EntityCombobox } from "@/components/entity-combobox";
import { useConfirm } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Option = { id: string; name: string };
type Person = { id: string; name: string; email?: string };
export type CampaignRow = {
  id: string;
  city: string;
  type: string;
  location: string;
  days: number;
  status: string;
  startDate: string;
  endDate: string;
  sales: Person;
  vendor: Person;
  client: Person;
  reminder: { id: string; date: string; sent: boolean; sentAt: string | null } | null;
};

type FormState = {
  clientId: string;
  salesId: string;
  vendorId: string;
  type: string;
  city: string;
  location: string;
  startDate: string;
  endDate: string;
  reminderDate: string;
  status: string;
};

const EMPTY: FormState = {
  clientId: "",
  salesId: "",
  vendorId: "",
  type: "",
  city: "",
  location: "",
  startDate: "",
  endDate: "",
  reminderDate: "",
  status: "LIVE",
};

function addDaysISO(iso: string, days: number) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toDateInputValue(d);
}

function byDate(key: "startDate" | "endDate") {
  return (a: { original: CampaignRow }, b: { original: CampaignRow }) =>
    new Date(a.original[key]).getTime() - new Date(b.original[key]).getTime();
}

export function CampaignManager({
  campaigns,
  options,
}: {
  campaigns: CampaignRow[];
  options: { clients: Option[]; sales: Option[]; vendors: Option[] };
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [reminderTouched, setReminderTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "LIVE" | "EXPIRING" | "ENDED" | "SENT_TODAY"
  >("all");

  const missingRefs =
    options.clients.length === 0 ||
    options.sales.length === 0 ||
    options.vendors.length === 0;

  const isSentToday = useCallback((c: CampaignRow) => {
    if (!c.reminder?.sent || !c.reminder.sentAt) return false;
    return (
      startOfDay(new Date(c.reminder.sentAt)).getTime() ===
      startOfDay(new Date()).getTime()
    );
  }, []);

  const stats = useMemo(() => {
    const live = campaigns.filter(
      (c) => lifecycleState({ status: c.status, endDate: new Date(c.endDate) }) === "LIVE",
    ).length;
    const expiring = campaigns.filter((c) =>
      isExpiringSoon({ status: c.status, endDate: new Date(c.endDate) }),
    ).length;
    const sentToday = campaigns.filter(isSentToday).length;
    return {
      total: campaigns.length,
      live,
      ended: campaigns.length - live,
      expiring,
      sentToday,
    };
  }, [campaigns, isSentToday]);

  const filteredCampaigns = useMemo(() => {
    if (statusFilter === "all") return campaigns;
    if (statusFilter === "EXPIRING")
      return campaigns.filter((c) =>
        isExpiringSoon({ status: c.status, endDate: new Date(c.endDate) }),
      );
    if (statusFilter === "SENT_TODAY") return campaigns.filter(isSentToday);
    return campaigns.filter(
      (c) =>
        lifecycleState({ status: c.status, endDate: new Date(c.endDate) }) ===
        statusFilter,
    );
  }, [campaigns, statusFilter, isSentToday]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY);
    setReminderTouched(false);
    setOpen(true);
  }

  const openEdit = useCallback((c: CampaignRow) => {
    setEditingId(c.id);
    setForm({
      clientId: c.client.id,
      salesId: c.sales.id,
      vendorId: c.vendor.id,
      type: c.type,
      city: c.city,
      location: c.location,
      startDate: toDateInputValue(c.startDate),
      endDate: toDateInputValue(c.endDate),
      reminderDate: c.reminder ? toDateInputValue(c.reminder.date) : "",
      status: c.status,
    });
    setReminderTouched(true);
    setOpen(true);
  }, []);

  const effectiveReminder =
    reminderTouched || !form.endDate
      ? form.reminderDate
      : addDaysISO(form.endDate, -7);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = JSON.stringify({
      clientId: form.clientId,
      salesId: form.salesId,
      vendorId: form.vendorId,
      city: form.city,
      type: form.type,
      location: form.location,
      startDate: form.startDate,
      endDate: form.endDate,
      reminderDate: effectiveReminder || undefined,
      status: form.status,
    });
    const res = editingId
      ? await apiFetch(`/api/campaigns/${editingId}`, { method: "PATCH", body: payload })
      : await apiFetch(`/api/campaigns`, { method: "POST", body: payload });
    setSaving(false);
    if (!res.ok) return toast.error(apiError(res.data));
    toast.success(`Campaign ${editingId ? "updated" : "created"}`);
    setOpen(false);
    router.refresh();
  }

  const sendReminder = useCallback(
    async (c: CampaignRow) => {
      const res = await apiFetch(`/api/campaigns/${c.id}/send-reminder`, {
        method: "POST",
      });
      if (!res.ok) return toast.error(apiError(res.data, "Failed to send"));
      toast.success(`Reminder sent to ${c.sales.email ?? c.sales.name}`);
      router.refresh();
    },
    [router],
  );

  const remove = useCallback(
    async (c: CampaignRow) => {
      const ok = await confirm({
        title: "Delete campaign?",
        description: `The ${c.client.name} campaign in ${c.city} and its reminder will be permanently deleted.`,
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
        id: "vendor",
        accessorFn: (c) => c.vendor.name,
        header: "Vendor",
      },
      {
        accessorKey: "type",
        header: "Type",
      },
      {
        accessorKey: "city",
        header: "City",
      },
      {
        accessorKey: "location",
        header: "Location",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue<string>()}</span>
        ),
      },
      {
        id: "startDate",
        accessorFn: (c) => formatDate(c.startDate),
        header: "Start date",
        sortingFn: byDate("startDate"),
      },
      {
        id: "endDate",
        accessorFn: (c) => formatDate(c.endDate),
        header: "End date",
        sortingFn: byDate("endDate"),
      },
      {
        id: "daysLeft",
        accessorFn: (c) => daysUntil(new Date(c.endDate)),
        header: "Days left",
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const c = row.original;
          const left = daysUntil(new Date(c.endDate));
          const ended =
            lifecycleState({ status: c.status, endDate: new Date(c.endDate) }) ===
            "ENDED";
          return (
            <span
              className={
                ended ? "text-muted-foreground" : left <= 7 ? "text-amber-600" : ""
              }
            >
              {left < 0 ? `${Math.abs(left)}d ago` : `${left}d`}
            </span>
          );
        },
      },
      {
        id: "reminder",
        accessorFn: (c) =>
          c.reminder
            ? c.reminder.sent
              ? `Sent ${formatDate(c.reminder.sentAt ?? c.reminder.date)}`
              : formatDate(c.reminder.date)
            : "—",
        header: "Reminder",
        cell: ({ getValue, row }) => {
          const sent = row.original.reminder?.sent ?? false;
          return (
            <span
              className={cn(
                "inline-flex rounded-md px-1.5 py-0.5",
                sent
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "text-muted-foreground",
              )}
            >
              {getValue<string>()}
            </span>
          );
        },
      },
      {
        id: "status",
        accessorFn: (c) =>
          lifecycleState({ status: c.status, endDate: new Date(c.endDate) }),
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} endDate={row.original.endDate} />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableGlobalFilter: false,
        meta: { className: "w-0 text-right" },
        cell: ({ row }) => (
          <RowActions>
            <DropdownMenuItem onClick={() => sendReminder(row.original)}>
              Send reminder
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
            searchPlaceholder="Search client, sales, vendor, city…"
            empty={
              campaigns.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <p className="text-sm text-muted-foreground">
                    No campaigns yet.
                    {missingRefs && " Add a client, sales person and vendor first."}
                  </p>
                  {missingRefs ? (
                    <div className="flex gap-2 text-sm">
                      <Link href="/clients" className="underline">Clients</Link>
                      <Link href="/sales" className="underline">Sales</Link>
                      <Link href="/vendors" className="underline">Vendors</Link>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit campaign" : "New campaign"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={save} className="grid max-h-[70vh] gap-4 overflow-y-auto px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client">
                <EntityCombobox
                  kind="clients"
                  label="Client"
                  value={form.clientId}
                  onChange={(v) => set("clientId", v)}
                  options={options.clients}
                />
              </Field>
              <Field label="Sales person">
                <EntityCombobox
                  kind="sales"
                  label="Sales person"
                  value={form.salesId}
                  onChange={(v) => set("salesId", v)}
                  options={options.sales}
                />
              </Field>
              <Field label="Vendor">
                <EntityCombobox
                  kind="vendors"
                  label="Vendor"
                  value={form.vendorId}
                  onChange={(v) => set("vendorId", v)}
                  options={options.vendors}
                />
              </Field>
              <Field label="Type">
                <Input value={form.type} onChange={(e) => set("type", e.target.value)} placeholder="Billboard, Digital…" required />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Mumbai" required />
              </Field>
              <Field label="Location">
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Andheri West" required />
              </Field>
              <Field label="Start date">
                <Input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} required />
              </Field>
              <Field label="End date">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                  required
                />
              </Field>
              <Field label="Reminder date">
                <Input
                  type="date"
                  value={effectiveReminder}
                  onChange={(e) => {
                    setReminderTouched(true);
                    set("reminderDate", e.target.value);
                  }}
                />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => set("status", v ?? "LIVE")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(status: string | null) =>
                        status === "ENDED" ? "Ended" : "Live"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LIVE">Live</SelectItem>
                    <SelectItem value="ENDED">Ended</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Reminder defaults to 7 days before the end date; the sales person is
              emailed on that day.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create campaign"}
              </Button>
            </div>
          </form>
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
        active && "ring-1 ring-black/20 hover:bg-card",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${accent === "amber" ? "text-amber-600" : ""}`}>
        {value}
      </p>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

