"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type PaginationState,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
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
  Loader2Icon,
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

export const PAGE_SIZES = [5, 10, 20, 50];

/**
 * Server-driven table. Pagination, sorting and filtering all happen in the
 * database — `data` is one page, and `rowCount` is the size of the whole
 * result set.
 *
 * State is lifted rather than held here so the owner can feed it into a query
 * key; that also makes `search` debounceable at the owner's level (see
 * useDebounced below).
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  rowCount,
  pagination,
  onPaginationChange,
  sorting,
  onSortingChange,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  isLoading = false,
  isFetching = false,
  empty,
  renderExpanded,
  onRowClick,
}: {
  columns: ColumnDef<TData, TValue>[];
  /** The current page of rows, already filtered and sorted by the server. */
  data: TData[];
  /** Total matching rows across all pages. */
  rowCount: number;
  pagination: PaginationState;
  onPaginationChange: React.Dispatch<React.SetStateAction<PaginationState>>;
  sorting: SortingState;
  onSortingChange: React.Dispatch<React.SetStateAction<SortingState>>;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** First load, with nothing to show yet. */
  isLoading?: boolean;
  /** A background refetch — rows on screen are still the previous page. */
  isFetching?: boolean;
  /** Rendered instead of the table when there is no data at all. */
  empty?: React.ReactNode;
  /**
   * Renders a detail panel beneath a row, revealed by a chevron in a leading
   * column. A panel rather than TanStack's `getSubRows` because the nested
   * records (e.g. a campaign's locations) have their own column shape.
   */
  renderExpanded?: (row: TData) => React.ReactNode;
  /**
   * Makes rows activatable. Clicks originating from a button/link/input inside
   * a cell are ignored, so row actions keep working.
   */
  onRowClick?: (row: TData) => void;
}) {
  const [expanded, setExpanded] = React.useState<ExpandedState>({});

  const expandable = Boolean(renderExpanded);

  const table = useReactTable({
    data,
    columns,
    rowCount,
    state: { sorting, pagination, expanded },
    // The server owns all three; the client row models would re-do the work
    // on the current page only, which is worse than doing nothing.
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    onSortingChange,
    onPaginationChange,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => expandable,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  // Only bail out to the empty slot on a genuinely empty *unfiltered* result —
  // "no rows for this search" is handled inside the table, where the search
  // box is still reachable.
  if (!isLoading && rowCount === 0 && !search && empty)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {empty}
      </div>
    );

  const rows = table.getRowModel().rows;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-4 pb-3">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 max-w-xs"
        />
        {/* Inline rather than a full-table spinner: with keepPreviousData the
            rows on screen are still valid, just one page behind. */}
        {isFetching && !isLoading && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
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
                {isLoading ? "Loading…" : "No results."}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const isExpanded = row.getIsExpanded();
              return (
                <React.Fragment key={row.id}>
                  <TableRow
                    className={cn(onRowClick && "cursor-pointer")}
                    {...(onRowClick && {
                      role: "button",
                      tabIndex: 0,
                      onClick: (e: React.MouseEvent<HTMLTableRowElement>) => {
                        // Row actions, links and the expand chevron live
                        // inside cells; activating one must not also open
                        // whatever the row itself does.
                        if (
                          (e.target as HTMLElement).closest(
                            "button, a, input, [role='menuitem']",
                          )
                        ) {
                          return;
                        }
                        onRowClick(row.original);
                      },
                      onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      },
                    })}
                  >
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
        filtered={rowCount}
        canPrevious={table.getCanPreviousPage()}
        canNext={table.getCanNextPage()}
        // Changing the page size shifts every boundary, so go back to page 1
        // rather than landing on an offset that no longer means anything.
        onPageSize={(size) => table.setPagination({ pageIndex: 0, pageSize: size })}
        onPage={(index) => table.setPageIndex(index)}
        onPrevious={() => table.previousPage()}
        onNext={() => table.nextPage()}
      />
    </div>
  );
}

/**
 * Debounce a value before it reaches a query key.
 *
 * Every keystroke used to re-filter in memory; now it would be a request, so
 * the search box feeds this and the query sees only the settled value.
 */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * The state a server-driven DataTable needs, plus the resets that keep it
 * coherent: changing the search term or the sort invalidates the current
 * offset, since page 3 of the old result set may not exist in the new one.
 *
 * The resets live in the setters rather than an effect — the offset is
 * derived from the query that produced it, so it's corrected at the moment
 * that query changes rather than a render later.
 */
export function useTableState(defaultPageSize = 10) {
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });
  const [sorting, setSortingState] = React.useState<SortingState>([]);
  const [search, setSearchState] = React.useState("");
  const debouncedSearch = useDebounced(search);

  const toFirstPage = React.useCallback(
    () => setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 })),
    [],
  );

  const setSearch = React.useCallback(
    (value: string) => {
      setSearchState(value);
      toFirstPage();
    },
    [toFirstPage],
  );

  const setSorting = React.useCallback<
    React.Dispatch<React.SetStateAction<SortingState>>
  >(
    (value) => {
      setSortingState(value);
      toFirstPage();
    },
    [toFirstPage],
  );

  return {
    pagination,
    setPagination,
    sorting,
    setSorting,
    search,
    setSearch,
    debouncedSearch,
    toFirstPage,
  };
}

/** Translate TanStack's SortingState into the API's `sort`/`dir` pair. */
export function sortParams(sorting: SortingState) {
  const first = sorting[0];
  if (!first) return {};
  return { sort: first.id, dir: first.desc ? ("desc" as const) : ("asc" as const) };
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
