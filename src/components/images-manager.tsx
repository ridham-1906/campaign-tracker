"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageIcon, PlusIcon } from "lucide-react";
import { formatDate } from "@/lib/campaign";
import { STAGE_LABELS } from "@/lib/attachments";
import { AddImagesWizard } from "@/components/add-images-wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { CampaignRow } from "@/components/campaign-manager";

/** One row per (location, type) that has at least one file — a summary, not
 * a per-file listing. Individual files are viewed/deleted via the wizard's
 * location editor. */
type AttachmentGroup = {
  key: string;
  clientName: string;
  locationLabel: string;
  city: string;
  typeLabel: string;
  count: number;
  latestUploadedAt: string;
};

function groupAttachments(campaigns: CampaignRow[]): AttachmentGroup[] {
  const groups = new Map<string, AttachmentGroup>();

  for (const c of campaigns) {
    for (const l of c.locations) {
      for (const a of l.attachments) {
        const typeLabel = a.kind === "image" && a.stage ? STAGE_LABELS[a.stage] : "Creative deck";
        const key = `${l.id}:${typeLabel}`;
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
          if (new Date(a.uploadedAt) > new Date(existing.latestUploadedAt)) {
            existing.latestUploadedAt = a.uploadedAt;
          }
        } else {
          groups.set(key, {
            key,
            clientName: c.client.name,
            locationLabel: l.location,
            city: l.city,
            typeLabel,
            count: 1,
            latestUploadedAt: a.uploadedAt,
          });
        }
      }
    }
  }

  return [...groups.values()];
}

export function ImagesManager({ campaigns }: { campaigns: CampaignRow[] }) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Bumped every time the wizard opens so it remounts with fresh step/
  // selection state instead of resuming wherever it was left last time.
  const [wizardKey, setWizardKey] = useState(0);

  function openWizard() {
    setWizardKey((k) => k + 1);
    setWizardOpen(true);
  }

  const groups = useMemo(() => groupAttachments(campaigns), [campaigns]);

  const columns = useMemo<ColumnDef<AttachmentGroup>[]>(
    () => [
      {
        id: "client",
        accessorFn: (g) => `${g.clientName} ${g.locationLabel} ${g.city}`,
        header: "Client",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.clientName}</span>
        ),
      },
      {
        id: "location",
        accessorFn: (g) => `${g.locationLabel} · ${g.city}`,
        header: "Location",
        enableGlobalFilter: false,
      },
      {
        id: "type",
        accessorFn: (g) => g.typeLabel,
        header: "Type",
        enableGlobalFilter: false,
      },
      {
        id: "uploadedAt",
        accessorFn: (g) => new Date(g.latestUploadedAt).getTime(),
        header: "Uploaded",
        enableGlobalFilter: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.latestUploadedAt)}
          </span>
        ),
      },
      {
        id: "count",
        accessorFn: (g) => g.count,
        header: "Files",
        enableGlobalFilter: false,
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
            data={groups}
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

      <AddImagesWizard
        key={wizardKey}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        campaigns={campaigns}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
