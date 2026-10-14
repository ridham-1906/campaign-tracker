"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { lifecycleState } from "@/lib/campaign";
import {
  useCampaignQuery,
  useDeleteCampaign,
  useRenewCampaign,
  useSaveCampaign,
  useSendReminder,
} from "@/lib/queries/campaigns";
import { toDraft, renewalDraft, locationPayload } from "@/lib/campaign-draft";
import { useConfirm } from "@/components/use-confirm";
import { CampaignLocationsTable } from "@/components/campaign-locations-table";
import { RemindVendorDialog } from "@/components/remind-vendor-dialog";
import {
  CampaignForm,
  type CampaignDraft,
  type CampaignFormMode,
} from "@/components/campaign-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RowActions } from "@/components/ui/row-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CampaignView } from "@/lib/view-types";

/** Satisfied by both LocationView and the attachment-less CampaignListLocationView
 * CampaignLocationsTable's `actions` callback hands back. */
function stateOf(l: { status: string; endDate: string | Date }) {
  return lifecycleState({ status: l.status, endDate: new Date(l.endDate) });
}

/**
 * One campaign, on its own page — replaces the inline expand-row the
 * Campaigns and Dashboard tables used to show, and carries everything that
 * used to live in that row's "…" menu: send reminder, remind vendor, edit,
 * renew, delete.
 *
 * Readable by any signed-in user, same as the Dashboard row it's reached
 * from (see the GET handler's comment); read-only unless the viewer owns it
 * — same gating the list rows already apply, see `isOwn` in
 * campaign-manager.tsx.
 */
export function CampaignDetail({
  id,
  currentUserId,
}: {
  id: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const query = useCampaignQuery(id);

  const saveCampaign = useSaveCampaign();
  const renewCampaign = useRenewCampaign();
  const deleteCampaign = useDeleteCampaign();
  const sendReminderMutation = useSendReminder();
  const [remindVendorFor, setRemindVendorFor] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CampaignFormMode>("edit");
  const [draft, setDraft] = useState<CampaignDraft | null>(null);
  // Bumped on every open so the form remounts with fresh step state.
  const [formNonce, setFormNonce] = useState(0);

  const c = query.data;

  function openEdit(campaign: CampaignView) {
    setMode("edit");
    setDraft(toDraft(campaign));
    setFormNonce((n) => n + 1);
    setOpen(true);
  }

  function openRenew(campaign: CampaignView) {
    setMode("renew");
    setDraft(renewalDraft(campaign));
    setFormNonce((n) => n + 1);
    setOpen(true);
  }

  const closeOnSuccess = { onSuccess: () => setOpen(false) };

  function save() {
    if (!c || !draft) return;
    const locations = draft.locations.map(locationPayload);

    if (mode === "renew") {
      renewCampaign.mutate({ id: c.id, locations }, closeOnSuccess);
      return;
    }

    saveCampaign.mutate(
      {
        id: c.id,
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
  function sendReminder(locationId?: string) {
    if (!c) return;
    sendReminderMutation.mutate({
      campaignId: c.id,
      locationId,
      recipient: c.sales.email ?? c.sales.name,
    });
  }

  async function remove() {
    if (!c) return;
    const ok = await confirm({
      title: "Delete campaign?",
      description: `The ${c.client.name} campaign and all ${c.locations.length} of its locations will be permanently deleted.`,
      confirmLabel: "Delete campaign",
    });
    if (!ok) return;
    // The campaign this page is showing won't exist any more — back to the list.
    deleteCampaign.mutate(c.id, { onSuccess: () => router.push("/campaigns") });
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!c) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">Campaign not found.</p>
        <Button variant="outline" onClick={() => router.push("/campaigns")}>
          Back to campaigns
        </Button>
      </div>
    );
  }

  // `owner` is always present (see getCampaign()); it's only interesting here
  // when an admin is looking at a campaign that isn't theirs.
  const isOwn = !c.owner || c.owner.id === currentUserId;
  const anyLive = c.locations.some((l) => stateOf(l) === "LIVE");
  const live = c.locations.filter((l) => stateOf(l) === "LIVE").length;
  const pending = c.locations.filter((l) => stateOf(l) === "PENDING_CREATIVE").length;
  const ended = c.locations.length - live - pending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex shrink-0 flex-col gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back
        </button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {c.client.name}
              {c.term > 1 && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Term {c.term}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {c.sales.name}
              {c.category && ` · ${c.category}`}
              {!isOwn && c.owner && ` · Backend: ${c.owner.name}`}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {live > 0 && (
              <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                {live} live
              </span>
            )}
            {pending > 0 && (
              <span className="rounded-md bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                {pending} pending creative
              </span>
            )}
            {ended > 0 && (
              <span className="rounded-md bg-slate-200 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {ended} ended
              </span>
            )}
          </div>
        </div>

        {isOwn && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!anyLive}
                onClick={() => sendReminder()}
              >
                Send reminder (all live)
              </Button>
              <Button variant="outline" onClick={() => setRemindVendorFor(c.id)}>
                Remind vendor
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openEdit(c)}>
                Edit
              </Button>
              <Button variant="outline" onClick={() => openRenew(c)}>
                Renew
              </Button>
              <Button variant="outline" className="text-destructive" onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-0 thin-scrollbar">
          <CampaignLocationsTable
            locations={c.locations}
            actions={(l) =>
              isOwn && (
                <RowActions>
                  <DropdownMenuItem
                    disabled={stateOf(l) === "ENDED"}
                    onClick={() => sendReminder(l.id)}
                  >
                    Send reminder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openEdit(c)}>
                    Edit campaign
                  </DropdownMenuItem>
                </RowActions>
              )
            }
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{mode === "renew" ? "Renew campaign" : "Edit campaign"}</DialogTitle>
          </DialogHeader>

          {draft && (
            <CampaignForm
              key={formNonce}
              draft={draft}
              setDraft={setDraft}
              mode={mode}
              saving={saveCampaign.isPending || renewCampaign.isPending}
              onSubmit={save}
              onCancel={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <RemindVendorDialog
        campaignId={remindVendorFor}
        onClose={() => setRemindVendorFor(null)}
      />

      {confirmDialog}
    </div>
  );
}
