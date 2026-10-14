"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { businessToday, formatDate, toDateInputValue } from "@/lib/campaign";
import {
  useSaveVendorSchedule,
  useVendorSchedule,
  type VendorSchedule,
  type VendorStage,
} from "@/lib/queries/campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const VENDOR_STAGE_FIELDS: { stage: VendorStage; label: string; hint: string }[] = [
  {
    stage: "installation",
    label: "Installation photo dates",
    hint: "On each date, vendors are asked for installation photos.",
  },
  {
    stage: "mid_date",
    label: "Mid date photo dates",
    hint: "On each date, vendors are asked for mid-campaign photos.",
  },
  {
    stage: "end_date",
    label: "End date photo dates",
    hint: "On each date, vendors are asked for closing photos.",
  },
];

const EMPTY_SCHEDULE: VendorSchedule = { installation: [], mid_date: [], end_date: [] };

/**
 * "Remind vendor…": three date lists, one per stage. On each date, every
 * vendor on this campaign is emailed for that stage's photo — only about its
 * own sites, and only the ones still missing it. Sent by the hourly cron; a
 * date set to today goes out on the next run.
 *
 * Shared by the Campaigns list and the single campaign page — both open the
 * same dialog for the same campaignId.
 */
export function RemindVendorDialog({
  campaignId,
  onClose,
}: {
  campaignId: string | null;
  onClose: () => void;
}) {
  const query = useVendorSchedule(campaignId);
  const save = useSaveVendorSchedule();

  return (
    <Dialog
      open={campaignId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remind vendor</DialogTitle>
        </DialogHeader>
        {query.isLoading || !campaignId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <VendorScheduleForm
            // Remount per campaign so the draft starts from what's saved.
            key={campaignId}
            initial={query.data ?? EMPTY_SCHEDULE}
            saving={save.isPending}
            onCancel={onClose}
            onSave={(schedule) =>
              save.mutate({ campaignId, schedule }, { onSuccess: onClose })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function VendorScheduleForm({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: VendorSchedule;
  saving: boolean;
  onCancel: () => void;
  onSave: (schedule: VendorSchedule) => void;
}) {
  const [schedule, setSchedule] = useState<VendorSchedule>(initial);

  return (
    <>
      <div className="space-y-4">
        {VENDOR_STAGE_FIELDS.map((f) => (
          <DateListField
            key={f.stage}
            id={`remind-vendor-${f.stage}`}
            label={f.label}
            hint={f.hint}
            dates={schedule[f.stage]}
            onChange={(dates) => setSchedule((prev) => ({ ...prev, [f.stage]: dates }))}
          />
        ))}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={saving} onClick={() => onSave(schedule)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Pick a date, Add, repeat — each shown as a removable pill. */
function DateListField({
  id,
  label,
  hint,
  dates,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  dates: string[];
  onChange: (dates: string[]) => void;
}) {
  const today = toDateInputValue(businessToday());
  const [pick, setPick] = useState("");

  function add() {
    if (!pick || dates.includes(pick)) return;
    onChange([...dates, pick].sort());
    setPick("");
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="date"
          min={today}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={!pick || dates.includes(pick)}
        >
          Add
        </Button>
      </div>
      {dates.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <span
              key={d}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                d < today && "text-muted-foreground line-through",
              )}
            >
              {formatDate(d)}
              <button
                type="button"
                aria-label={`Remove ${formatDate(d)}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(dates.filter((x) => x !== d))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
