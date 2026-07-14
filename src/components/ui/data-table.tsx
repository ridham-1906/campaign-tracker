"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ChevronsUpDownIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes applied to both the header cell and the body cells. */
    className?: string;
  }
}

const PAGE_SIZES = [5, 10, 20, 50];

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "Search…",
  pageSize = 10,
  empty,
  renderExpanded,
}: {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  pageSize?: number;
  /** Rendered instead of the table when there is no data at all. */
  empty?: React.ReactNode;
  /**
   * Renders a detail panel beneath a row, revealed by a chevron in a leading
   * column. A panel rather than TanStack's `getSubRows` because the nested
   * records (e.g. a campaign's locations) have their own column shape.
   */
  renderExpanded?: (row: TData) => React.ReactNode;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  const expandable = Boolean(renderExpanded);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => expandable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  if (data.length === 0 && empty)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {empty}
      </div>
    );

  const rows = table.getRowModel().rows;
  const pagination = table.getState().pagination;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-4 pb-3">
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 max-w-xs"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table containerClassName="min-h-full">
        <TableHeader className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {expandable && <TableHead className="w-0 pl-4" />}
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const content = header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    );

                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "px-4",
                      header.column.columnDef.meta?.className,
                    )}
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground/70 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {content}
                        {sorted === "asc" ? (
                          <ArrowUpIcon className="size-3.5" />
                        ) : sorted === "desc" ? (
                          <ArrowDownIcon className="size-3.5" />
                        ) : (
                          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/50" />
                        )}
                      </button>
                    ) : (
                      content
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length + (expandable ? 1 : 0)}
                className="h-24 text-center text-sm text-muted-foreground"
              >
                No results.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const isExpanded = row.getIsExpanded();
              return (
                <React.Fragment key={row.id}>
                  <TableRow>
                    {expandable && (
                      <TableCell className="w-0 pl-4">
                        <button
                          type="button"
                          onClick={row.getToggleExpandedHandler()}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? "Collapse row" : "Expand row"}
                          className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <ChevronDownIcon
                            className={cn(
                              "size-4 transition-transform",
                              !isExpanded && "-rotate-90",
                            )}
                          />
                        </button>
                      </TableCell>
                    )}
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "px-4",
                          cell.column.columnDef.meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>

                  {isExpanded && renderExpanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={row.getVisibleCells().length + 1}
                        className="whitespace-normal bg-muted/30 p-0"
                      >
                        {renderExpanded(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
        </Table>
      </div>

      <DataTablePagination
        pageIndex={pagination.pageIndex}
        pageSize={pagination.pageSize}
        pageCount={table.getPageCount()}
        filtered={table.getFilteredRowModel().rows.length}
        canPrevious={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        onPageSize={(size) => table.setPageSize(size)}
        onPage={(index) => table.setPageIndex(index)}
        onPrevious={() => table.previousPage()}
        onNext={() => table.nextPage()}
      />
    </div>
  );
}

/**
 * Takes plain values rather than the `table` instance: the instance keeps a
 * stable identity while its internal state mutates, so a memoizing compiler
 * would never re-render these controls.
 */
function DataTablePagination({
  pageIndex,
  pageSize,
  pageCount,
  filtered,
  canPrevious,
  canNext,
  onPageSize,
  onPage,
  onPrevious,
  onNext,
}: {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  filtered: number;
  canPrevious: boolean;
  canNext: boolean;
  onPageSize: (size: number) => void;
  onPage: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const from = filtered === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min((pageIndex + 1) * pageSize, filtered);

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {filtered === 0
          ? "No rows"
          : `Showing ${from}–${to} of ${filtered} row${filtered === 1 ? "" : "s"}`}
      </p>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSize(Number(v ?? pageSize))}
          >
            <SelectTrigger size="sm" className="w-17">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(1, pageCount)}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="First page"
            disabled={!canPrevious}
            onClick={() => onPage(0)}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={!canPrevious}
            onClick={onPrevious}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={!canNext}
            onClick={onNext}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Last page"
            disabled={!canNext}
            onClick={() => onPage(pageCount - 1)}
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
