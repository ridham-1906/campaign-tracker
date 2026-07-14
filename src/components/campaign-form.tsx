"use client";

import { useMemo, useState } from "react";
import {
  AlertCircleIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DEFAULT_REMINDER_LEAD_DAYS,
  addDays,
  toDateInputValue,
} from "@/lib/campaign";
import { parseCampaignExcel } from "@/lib/campaign-excel";
import { cn } from "@/lib/utils";
import { EntityCombobox } from "@/components/entity-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Option = { id: string; name: string };
export type FormOptions = {
  clients: Option[];
  sales: Option[];
  vendors: Option[];
};

/** A location as the form holds it. `id` is set only for existing locations. */
export type LocationDraft = {
  id?: string;
  city: string;
  location: string;
  type: string;
  vendorId: string;
  startDate: string;
  endDate: string;
  reminderDate: string;
  /** Once the reminder is hand-edited it stops following the end date. */
  reminderTouched: boolean;
  status: string;
};

export type CampaignDraft = {
  clientId: string;
  salesId: string;
  locations: LocationDraft[];
};

export function emptyLocation(): LocationDraft {
  return {
    city: "",
    location: "",
    type: "",
    vendorId: "",
    startDate: "",
    endDate: "",
    reminderDate: "",
    reminderTouched: false,
    status: "LIVE",
  };
}

export function emptyCampaign(): CampaignDraft {
  return { clientId: "", salesId: "", locations: [emptyLocation()] };
}

/**
 * The reminder shown for a location: until the user edits it, it tracks the end
 * date at the standard lead time, the same rule the server applies on save.
 */
export function effectiveReminder(l: LocationDraft) {
  if (l.reminderTouched || !l.endDate) return l.reminderDate;
  return toDateInputValue(
    addDays(new Date(l.endDate), -DEFAULT_REMINDER_LEAD_DAYS),
  );
}

const CREATE_STEPS = [
  "Details",
  "Upload Excel",
  "Locations",
  "Dates & reminders",
] as const;
const EDIT_STEPS = ["Details", "Locations", "Dates & reminders"] as const;

export function CampaignForm({
  draft,
  setDraft,
  options,
  editing,
  saving,
  onSubmit,
  onCancel,
}: {
  draft: CampaignDraft;
  setDraft: (next: CampaignDraft) => void;
  options: FormOptions;
  editing: boolean;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const steps = editing ? EDIT_STEPS : CREATE_STEPS;
  const currentStep = steps[step];

  function setLocation(index: number, patch: Partial<LocationDraft>) {
    setDraft({
      ...draft,
      locations: draft.locations.map((l, i) =>
        i === index ? { ...l, ...patch } : l,
      ),
    });
  }

  function addLocation() {
    setDraft({ ...draft, locations: [...draft.locations, emptyLocation()] });
  }

  function removeLocation(index: number) {
    if (draft.locations.length === 1) return; // a campaign needs at least one
    setDraft({
      ...draft,
      locations: draft.locations.filter((_, i) => i !== index),
    });
  }

  /** Copy the first location's dates onto the rest — the common case. */
  function applyDatesToAll() {
    const [first] = draft.locations;
    setDraft({
      ...draft,
      locations: draft.locations.map((l, i) =>
        i === 0
          ? l
          : {
              ...l,
              startDate: first.startDate,
              endDate: first.endDate,
              reminderDate: first.reminderTouched
                ? first.reminderDate
                : l.reminderDate,
              reminderTouched: first.reminderTouched,
            },
      ),
    });
  }

  async function importExcel(file: File | null) {
    if (!file) return;
    setImporting(true);
    setImportSummary(null);
    setImportWarnings([]);

    try {
      const result = await parseCampaignExcel(file, options.vendors);
      if (result.locations.length > 0) {
        setDraft({ ...draft, locations: result.locations });
      }
      setImportSummary(
        result.locations.length > 0
          ? `Imported ${result.locations.length} location${
              result.locations.length === 1 ? "" : "s"
            } from ${result.sheetName || file.name}.`
          : "No locations were imported.",
      );
      setImportWarnings(result.warnings);
    } catch {
      setImportSummary("Could not read this Excel file.");
      setImportWarnings(["Please upload a valid .xlsx, .xls or .csv file."]);
    } finally {
      setImporting(false);
    }
  }

  const stepValid = useMemo(() => {
    if (currentStep === "Details") return Boolean(draft.clientId && draft.salesId);
    if (currentStep === "Upload Excel") return true;
    if (currentStep === "Locations")
      return draft.locations.every(
        (l) => l.city.trim() && l.location.trim() && l.type.trim() && l.vendorId,
      );
    return draft.locations.every((l) => l.startDate && l.endDate);
  }, [currentStep, draft]);

  const datesOutOfOrder = draft.locations.some(
    (l) => l.startDate && l.endDate && l.endDate < l.startDate,
  );

  const isLast = step === steps.length - 1;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <ol className="flex shrink-0 items-center gap-2 text-xs">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              // Only allow jumping back; going forward must pass validation.
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors",
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "text-foreground hover:bg-muted"
                    : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full text-[10px] font-medium",
                  i === step
                    ? "bg-primary-foreground text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              {label}
            </button>
            {i < steps.length - 1 && (
              <span className="text-muted-foreground/40">›</span>
            )}
          </li>
        ))}
      </ol>

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {currentStep === "Details" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <EntityCombobox
                kind="clients"
                label="Client"
                value={draft.clientId}
                onChange={(v) => setDraft({ ...draft, clientId: v })}
                options={options.clients}
              />
            </Field>
            <Field label="Sales person">
              <EntityCombobox
                kind="sales"
                label="Sales person"
                value={draft.salesId}
                onChange={(v) => setDraft({ ...draft, salesId: v })}
                options={options.sales}
              />
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              The sales person receives every reminder for this campaign, across
              all its locations.
            </p>
          </div>
        )}

        {currentStep === "Upload Excel" && (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-muted p-2 text-muted-foreground">
                  <FileSpreadsheetIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div>
                    <p className="text-sm font-medium">Upload campaign sheet</p>
                    <p className="text-xs text-muted-foreground">
                      Use one campaign per file, with one row per location.
                      Expected columns are Vendor, City, Type, Location, Start
                      date and End date.
                    </p>
                  </div>
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={importing}
                    onChange={(e) => {
                      void importExcel(e.target.files?.[0] ?? null);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>
            </div>

            {importSummary && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{importSummary}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Review the imported fields in the next steps before creating
                  the campaign.
                </p>
              </div>
            )}

            {importWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <AlertCircleIcon className="size-4" />
                  Needs review
                </div>
                <ul className="max-h-44 space-y-1 overflow-y-auto text-xs">
                  {importWarnings.slice(0, 12).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                  {importWarnings.length > 12 && (
                    <li>{importWarnings.length - 12} more warnings...</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {currentStep === "Locations" && (
          <div className="space-y-3">
            {draft.locations.map((l, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    Location {i + 1}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove location ${i + 1}`}
                    disabled={draft.locations.length === 1}
                    onClick={() => removeLocation(i)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Location">
                    <Input
                      value={l.location}
                      onChange={(e) =>
                        setLocation(i, { location: e.target.value })
                      }
                      placeholder="Andheri West"
                    />
                  </Field>
                  <Field label="City">
                    <Input
                      value={l.city}
                      onChange={(e) => setLocation(i, { city: e.target.value })}
                      placeholder="Mumbai"
                    />
                  </Field>
                  <Field label="Type">
                    <Input
                      value={l.type}
                      onChange={(e) => setLocation(i, { type: e.target.value })}
                      placeholder="Billboard, Digital…"
                    />
                  </Field>
                  <Field label="Vendor">
                    <EntityCombobox
                      kind="vendors"
                      label="Vendor"
                      value={l.vendorId}
                      onChange={(v) => setLocation(i, { vendorId: v })}
                      options={options.vendors}
                    />
                  </Field>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" onClick={addLocation}>
              <PlusIcon />
              Add location
            </Button>
          </div>
        )}

        {currentStep === "Dates & reminders" && (
          <div className="space-y-3">
            {draft.locations.map((l, i) => (
              <div key={i} className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium">
                  {l.location || `Location ${i + 1}`}
                  {l.city && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {l.city}
                    </span>
                  )}
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Start date">
                    <Input
                      type="date"
                      value={l.startDate}
                      onChange={(e) =>
                        setLocation(i, { startDate: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="End date">
                    <Input
                      type="date"
                      value={l.endDate}
                      onChange={(e) =>
                        setLocation(i, { endDate: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Reminder">
                    <Input
                      type="date"
                      value={effectiveReminder(l)}
                      onChange={(e) =>
                        setLocation(i, {
                          reminderDate: e.target.value,
                          reminderTouched: true,
                        })
                      }
                    />
                  </Field>
                  <Field label="Status">
                    <Select
                      value={l.status}
                      onValueChange={(v) =>
                        setLocation(i, { status: v ?? "LIVE" })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(s: string | null) =>
                            s === "ENDED" ? "Ended" : "Live"
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
              </div>
            ))}

            {draft.locations.length > 1 && (
              <Button type="button" variant="outline" onClick={applyDatesToAll}>
                Apply first location&rsquo;s dates to all
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              Reminder defaults to {DEFAULT_REMINDER_LEAD_DAYS} days before each
              location&rsquo;s end date. A reminder dated in the past is sent on the
              next run.
            </p>

            {datesOutOfOrder && (
              <p className="text-xs text-destructive">
                An end date is before its start date.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          onClick={step === 0 ? onCancel : () => setStep(step - 1)}
        >
          {step === 0 ? "Cancel" : "Back"}
        </Button>

        {isLast ? (
          <Button
            type="button"
            disabled={saving || importing || !stepValid || datesOutOfOrder}
            onClick={onSubmit}
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Create campaign"}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={importing || !stepValid}
            onClick={() => setStep(step + 1)}
          >
            {importing ? "Importing..." : "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
