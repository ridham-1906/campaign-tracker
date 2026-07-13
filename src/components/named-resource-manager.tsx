"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { apiError, apiFetch } from "@/lib/http";
import { NamedResourceForm } from "@/components/entity-forms";
import { useConfirm } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

type Item = { id: string; name: string; count: number };

export function NamedResourceManager({
  resource,
  singular,
  description,
  items,
}: {
  resource: "vendors" | "clients";
  singular: string;
  description: string;
  items: Item[];
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  function openAdd() {
    setEditing(null);
    setOpen(true);
  }

  const openEdit = useCallback((item: Item) => {
    setEditing(item);
    setOpen(true);
  }, []);

  const remove = useCallback(
    async (item: Item) => {
      if (item.count > 0)
        return toast.error(`In use by ${item.count} campaign(s)`);
      const ok = await confirm({
        title: `Delete ${singular.toLowerCase()}?`,
        description: `${item.name} will be permanently deleted.`,
        confirmLabel: `Delete ${singular.toLowerCase()}`,
      });
      if (!ok) return;
      const res = await apiFetch(`/api/${resource}/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) return toast.error(apiError(res.data));
      toast.success(`${singular} deleted`);
      router.refresh();
    },
    [resource, singular, router, confirm],
  );

  const columns = useMemo<ColumnDef<Item>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "count",
        header: "Campaigns",
        cell: ({ row }) =>
          row.original.count > 0 ? (
            <Badge variant="secondary" className="text-xs">
              {row.original.count} campaign{row.original.count === 1 ? "" : "s"}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
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
            <DropdownMenuItem onClick={() => openEdit(row.original)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={row.original.count > 0}
              onClick={() => remove(row.original)}
            >
              Delete
              {row.original.count > 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  in use
                </span>
              )}
            </DropdownMenuItem>
          </RowActions>
        ),
      },
    ],
    [openEdit, remove],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{singular}s</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onClick={openAdd}>+ Add {singular.toLowerCase()}</Button>
      </div>

      <Card className="min-h-0 flex-1">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <DataTable
            columns={columns}
            data={items}
            searchPlaceholder={`Search ${singular.toLowerCase()}s…`}
            empty={
              <p className="p-8 text-center text-sm text-muted-foreground">
                No {singular.toLowerCase()}s yet.
              </p>
            }
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit ${singular.toLowerCase()}` : `Add ${singular.toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          <NamedResourceForm
            key={editing?.id ?? "new"}
            resource={resource}
            singular={singular}
            editing={editing}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
