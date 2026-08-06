"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { useDeleteEntity, useSalesListQuery } from "@/lib/queries/entities";
import { SalesForm } from "@/components/entity-forms";
import { useConfirm } from "@/components/use-confirm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTable,
  sortParams,
  useTableState,
} from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { SalesCountView } from "@/lib/view-types";

type Item = SalesCountView;

export function SalesManager() {
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const table = useTableState();
  const query = useSalesListQuery({
    page: table.pagination.pageIndex + 1,
    limit: table.pagination.pageSize,
    q: table.debouncedSearch || undefined,
    ...sortParams(table.sorting),
  });

  const deleteSales = useDeleteEntity("sales");

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
        title: "Delete sales person?",
        description: `${item.name} (${item.email}) will be permanently deleted.`,
        confirmLabel: "Delete sales person",
      });
      if (!ok) return;
      deleteSales.mutate(item.id);
    },
    [confirm, deleteSales],
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
        accessorKey: "email",
        header: "Email",
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.email}</span>
        ),
      },
      {
        accessorKey: "count",
        header: "Campaigns",
        // Counts cover the current page only, so the database can't order by
        // them — see ENTITY_SORT_KEYS in lib/data.ts.
        enableSorting: false,
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
          <h1 className="text-2xl font-semibold tracking-tight">Sales persons</h1>
          <p className="text-sm text-muted-foreground">
            The people who receive campaign-expiry reminder emails. Shared
            across the whole team.
          </p>
        </div>
        <Button onClick={openAdd}>+ Add sales person</Button>
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
            isLoading={query.isLoading}
            isFetching={query.isFetching}
            searchPlaceholder="Search by name…"
            empty={
              <p className="p-8 text-center text-sm text-muted-foreground">
                No sales persons yet.
              </p>
            }
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit sales person" : "Add sales person"}
            </DialogTitle>
            <DialogDescription>
              The email is where their campaign reminders are sent.
            </DialogDescription>
          </DialogHeader>
          <SalesForm
            key={editing?.id ?? "new"}
            editing={editing}
            onSaved={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
