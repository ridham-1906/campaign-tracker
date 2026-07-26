"use client";

import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageIcon, PlusIcon } from "lucide-react";
import { formatDate } from "@/lib/campaign";
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

  function openPreview(row: CampaignImagesRowView) {
    setPreview(row);
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
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </div>
  );
}
