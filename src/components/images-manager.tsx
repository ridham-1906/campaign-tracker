"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { formatDate } from "@/lib/campaign";
import { useCampaignQuery } from "@/lib/queries/campaigns";
import { useImagesQuery } from "@/lib/queries/attachments";
import { AddImagesWizard } from "@/components/add-images-wizard";
import { ImagePreviewDialog } from "@/components/image-preview/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DataTable,
  sortParams,
  useTableState,
} from "@/components/ui/data-table";
import type { CampaignImagesRowView } from "@/lib/view-types";

export function ImagesManager() {
  const [wizardOpen, setWizardOpen] = useState(false);
  // Bumped every time the wizard opens so it remounts with fresh step/
  // selection state instead of resuming wherever it was left last time.
  const [wizardKey, setWizardKey] = useState(0);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<CampaignImagesRowView | null>(null);
  const [previewLocationId, setPreviewLocationId] = useState<string | null>(
    null,
  );

  const table = useTableState();
  const query = useImagesQuery({
    page: table.pagination.pageIndex + 1,
    limit: table.pagination.pageSize,
    q: table.debouncedSearch || undefined,
    ...sortParams(table.sorting),
  });

  function openWizard() {
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }

  /** Omit `locationId` to open on the campaign's location picker. */
  function openPreview(row: CampaignImagesRowView, locationId?: string) {
    setPreview(row);
    setPreviewLocationId(locationId ?? null);
    setPreviewOpen(true);
  }

  const columns = useMemo<ColumnDef<CampaignImagesRowView>[]>(
    () => [
      {
        id: "client",
        header: "Client",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.clientName}</span>
        ),
      },
      {
        id: "locations",
        header: "Locations",
        cell: ({ row }) => <span>{row.original.locationCount}</span>,
      },
      {
        id: "count",
        header: "Files",
        cell: ({ row }) => <span>{row.original.fileCount}</span>,
      },
      {
        id: "uploadedAt",
        header: "Uploaded",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.latestUploadedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const renderLocations = useCallback(
    (row: CampaignImagesRowView) => (
      <ImageLocationsPanel
        row={row}
        onSelectLocation={(locationId) => openPreview(row, locationId)}
      />
    ),
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
          <p className="text-sm text-muted-foreground">
            Every photo and creative deck uploaded across your campaigns.
          </p>
        </div>
        <Button onClick={openWizard}>
          <PlusIcon />
          Add images
        </Button>
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
            onRowClick={openPreview}
            renderExpanded={renderLocations}
            searchPlaceholder="Search client, location, city…"
            empty={
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <ImageIcon className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No images or documents yet.
                </p>
                <Button onClick={openWizard}>
                  <PlusIcon />
                  Add images
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>

      {/* Uploads and deletes invalidate the images query from inside their
          mutations, so there's no onChanged callback to thread through. */}
      <AddImagesWizard
        key={wizardKey}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />

      <ImagePreviewDialog
        row={preview}
        locationId={previewLocationId}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}

/**
 * A campaign's locations, revealed by the row's expand chevron — how many
 * files each one has and when it last received an upload. Fetches the
 * campaign detail itself (rather than threading it down from the row, which
 * only carries the campaign-level rollup) so the request only happens once a
 * row is actually expanded.
 */
function ImageLocationsPanel({
  row,
  onSelectLocation,
}: {
  row: CampaignImagesRowView;
  onSelectLocation: (locationId: string) => void;
}) {
  const query = useCampaignQuery(row.id);
  const locations = query.data?.locations ?? [];

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Loading locations…
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No locations on this campaign.
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Location</th>
            <th className="pb-2 pr-4 font-medium">City</th>
            <th className="pb-2 pr-4 font-medium">Type</th>
            <th className="pb-2 pr-4 font-medium">Files</th>
            <th className="pb-2 font-medium">Last upload</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => {
            const latest = l.attachments.reduce<string | null>(
              (max, a) => (!max || a.uploadedAt > max ? a.uploadedAt : max),
              null,
            );
            return (
              <tr
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectLocation(l.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectLocation(l.id);
                  }
                }}
                className="cursor-pointer border-t outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <td className="py-2 pr-4 font-medium">{l.location}</td>
                <td className="py-2 pr-4">{l.city}</td>
                <td className="py-2 pr-4">{l.type}</td>
                <td className="py-2 pr-4">
                  {l.attachments.length === 0 ? (
                    <span className="text-muted-foreground">0</span>
                  ) : (
                    l.attachments.length
                  )}
                </td>
                <td className="py-2 text-muted-foreground">
                  {latest ? formatDate(latest) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
