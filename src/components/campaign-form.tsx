"use client";

import { useMemo, useState } from "react";
import {
  AlertCircleIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import {
  EXPIRY_REMINDER_OFFSETS,
  formatDate,
  nextReminderDate,
} from "@/lib/campaign";
import { parseCampaignExcel } from "@/lib/campaign-excel";
import { cn } from "@/lib/utils";
import { EntityCombobox } from "@/components/entity-combobox";
import { useEntityOptions } from "@/lib/queries/entities";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Options for the location filter, and the labels the status select reuses. */
const STATUS_LABELS: Record<string, string> = {
  all: "All statuses",
  LIVE: "Live",
  PENDING_CREATIVE: "Pending creative",
  ENDED: "Ended",
};

/** A location as the form holds it. `id` is set only for existing locations. */
export type LocationDraft = {
  id?: string;
  city: string;
  location: string;
  /** Media format — Billboard, Gantry, LED… */
  medium: string;
  vendorId: string;
  /** Illumination — "Lit" / "Nonlit". */
  type: string;
  // Dimensions are strings here because they are <Input> values; "" means the
  // user hasn't filled one in, which is not the same as 0.
  width: string;
  height: string;
  sqft: string;
  startDate: string;
  midDate: string;
  endDate: string;
  status: string;
};

export type CampaignDraft = {
  clientId: string;
  salesId: string;
  /** One value for the whole campaign, not per location. */
  category: string;
  locations: LocationDraft[];
};

export function emptyLocation(): LocationDraft {
  return {
    city: "",
    location: "",
    medium: "",
    vendorId: "",
    type: "",
    width: "",
    height: "",
    sqft: "",
    startDate: "",
    midDate: "",
    endDate: "",
    status: "LIVE",
  };
}

export function emptyCampaign(): CampaignDraft {
  return { clientId: "", salesId: "", category: "", locations: [emptyLocation()] };
}

/**
 * When the next reminder will go out, derived from the end date exactly as the
 * server does. Read-only — the schedule isn't editable.
 */
function reminderPreview(l: LocationDraft) {
  if (!l.endDate) return "Set an end date";
  const next = nextReminderDate(new Date(l.endDate));
  return next ? formatDate(next) : "Ends too soon to remind";
}

const CREATE_STEPS = [
  "Details",
  "Upload Excel",
  "Locations",
  "Dates & reminders",
] as const;
const EDIT_STEPS = ["Details", "Locations", "Dates & reminders"] as const;

/**
 * "renew" writes a new campaign like "create" does, but every field is already
 * carried over from the one being renewed — so it skips the Excel import step
 * and opens straight on the dates, which are the only thing that actually
 * changes. Earlier steps stay reachable via the step bar.
 */
export type CampaignFormMode = "create" | "edit" | "renew";

export function CampaignForm({
  draft,
  setDraft,
  mode,
  saving,
  onSubmit,
  onCancel,
}: {
  draft: CampaignDraft;
  setDraft: (next: CampaignDraft) => void;
  mode: CampaignFormMode;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  // Each EntityCombobox fetches its own options. The Excel importer is the one
  // consumer that needs the vendor list imperatively (to resolve names to
  // ids), so it reads the same cache entry the vendor combobox uses.
  const { data: vendorOptions = [] } = useEntityOptions("vendors");

  const steps = mode === "create" ? CREATE_STEPS : EDIT_STEPS;

  // A renewal opens on the last step — everything before it is already filled
  // in from the campaign being renewed.
  const [step, setStep] = useState(() =>
    mode === "renew" ? EDIT_STEPS.length - 1 : 0,
  );
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [locQuery, setLocQuery] = useState("");
  const [locStatus, setLocStatus] = useState("all");
  const [startFrom, setStartFrom] = useState("");
  const [endTo, setEndTo] = useState("");
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

  /**
   * W and H also drive SQFT, the way the source sheet's `= W * H` formula does.
   * The recomputed value goes out in the *same* patch as the edited dimension,
   * so this stays one render and one state write. SQFT keeps its own plain
   * `setLocation` handler, so a hand-entered area survives until W or H moves
   * again — some sites aren't rectangles.
   */
  function setSize(index: number, patch: { width?: string; height?: string }) {
    const l = draft.locations[index];
    const width = patch.width ?? l.width;
    const height = patch.height ?? l.height;
    const w = Number(width);
    const h = Number(height);
    const sqft =
      width.trim() && height.trim() && Number.isFinite(w) && Number.isFinite(h)
        ? String(w * h)
        : l.sqft;
    setLocation(index, { ...patch, sqft });
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
              midDate: first.midDate,
              endDate: first.endDate,
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
      const result = await parseCampaignExcel(file, vendorOptions);
      if (result.locations.length > 0) {
        setDraft({
          ...draft,
          // Category is campaign-wide, so it comes off the sheet once. An
          // absent column leaves whatever was already typed in.
          category: result.category || draft.category,
          locations: result.locations,
        });
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
        // Category and the W/H/SQFT/Type block are all optional.
        (l) => l.city.trim() && l.location.trim() && l.medium.trim() && l.vendorId,
      );
    return draft.locations.every((l) => l.startDate && l.endDate);
  }, [currentStep, draft]);

  const datesOutOfOrder = draft.locations.some(
    (l) =>
      (l.startDate && l.endDate && l.endDate < l.startDate) ||
      (l.midDate && l.startDate && l.midDate < l.startDate) ||
      (l.midDate && l.endDate && l.midDate > l.endDate),
  );

  const filtersActive = Boolean(
    locQuery.trim() || locStatus !== "all" || startFrom || endTo,
  );

  function clearLocationFilters() {
    setLocQuery("");
    setLocStatus("all");
    setStartFrom("");
    setEndTo("");
  }

  /**
   * Carries each location's original index so edits still target the right one
   * once the list is narrowed. Dates are `yyyy-mm-dd`, so string compare works.
   */
  const visibleLocations = useMemo(() => {
    const q = locQuery.trim().toLowerCase();
    return draft.locations
      .map((l, index) => ({ l, index }))
      .filter(({ l }) => {
        if (
          q &&
          ![l.location, l.city, l.medium, l.type].some((v) =>
            v.toLowerCase().includes(q),
          )
        ) {
          return false;
        }
        if (locStatus !== "all" && l.status !== locStatus) return false;
        // A location with no date yet is never filtered out, or it would be
        // impossible to reach and fill in.
        if (startFrom && l.startDate && l.startDate < startFrom) return false;
        if (endTo && l.endDate && l.endDate > endTo) return false;
        return true;
      });
  }, [draft.locations, locQuery, locStatus, startFrom, endTo]);

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

      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-1">
        {currentStep === "Details" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client">
              <EntityCombobox
                kind="clients"
                label="Client"
                value={draft.clientId}
                onChange={(v) => setDraft({ ...draft, clientId: v })}
              />
            </Field>
            <Field label="Sales person">
              <EntityCombobox
                kind="sales"
                label="Sales person"
                value={draft.salesId}
                onChange={(v) => setDraft({ ...draft, salesId: v })}
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
                      Expected columns are Vendor, City, Medium, Location, Start
                      date and End date. Category, W, H, SQFT and Type are picked
                      up too when the sheet has them.
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
                <ul className="max-h-44 space-y-1 overflow-y-auto thin-scrollbar text-xs">
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
            {/* Campaign-wide, so it sits above the list rather than repeating
                on every card. */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <Field label="Category">
                <Input
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="Applies to every location in this campaign"
                />
              </Field>
            </div>

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
                  <Field label="Medium">
                    <Input
                      value={l.medium}
                      onChange={(e) => setLocation(i, { medium: e.target.value })}
                      placeholder="Billboard, Gantry, LED…"
                    />
                  </Field>
                  <Field label="Vendor">
                    <EntityCombobox
                      kind="vendors"
                      label="Vendor"
                      value={l.vendorId}
                      onChange={(v) => setLocation(i, { vendorId: v })}
                    />
                  </Field>
                  {/* The sheet's W / H / SQFT / TYPE block, kept on one row so
                      it reads the way the spreadsheet does. */}
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-4">
                    <Field label="W">
                      <Input
                        inputMode="decimal"
                        value={l.width}
                        onChange={(e) => setSize(i, { width: e.target.value })}
                        placeholder="20"
                      />
                    </Field>
                    <Field label="H">
                      <Input
                        inputMode="decimal"
                        value={l.height}
                        onChange={(e) => setSize(i, { height: e.target.value })}
                        placeholder="10"
                      />
                    </Field>
                    <Field label="SQFT">
                      <Input
                        inputMode="decimal"
                        value={l.sqft}
                        onChange={(e) => setLocation(i, { sqft: e.target.value })}
                        placeholder="W × H"
                      />
                    </Field>
                    <Field label="Type">
                      <Input
                        value={l.type}
                        onChange={(e) => setLocation(i, { type: e.target.value })}
                        placeholder="Lit, Nonlit…"
                      />
                    </Field>
                  </div>
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
            {mode === "renew" && (
              <p className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                Client, sales person and every placement have been carried over.
                Each new term is suggested to start the day after the last one
                ended, keeping its original length — adjust anything below
                before creating the renewal.
              </p>
            )}

            {draft.locations.length > 1 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Input
                    value={locQuery}
                    onChange={(e) => setLocQuery(e.target.value)}
                    placeholder="Search location, city or type…"
                    className="flex-1"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Filter locations"
                          className="relative shrink-0"
                        />
                      }
                    >
                      <SlidersHorizontalIcon />
                      {filtersActive && (
                        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Status</DropdownMenuSubTrigger>
                        {/* Both submenus open left: there isn't room to the
                            right of the trigger, so letting them auto-place
                            puts them on opposite sides. */}
                        <DropdownMenuSubContent side="left" className="w-48">
                          <DropdownMenuRadioGroup
                            value={locStatus}
                            onValueChange={(v) => setLocStatus(String(v))}
                          >
                            {Object.entries(STATUS_LABELS).map(([v, label]) => (
                              <DropdownMenuRadioItem key={v} value={v}>
                                {label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Date</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent side="left" className="w-56">
                          {/* Keystrokes must not reach the menu, or its typeahead
                              hijacks the date fields. */}
                          <div
                            className="space-y-2 p-1.5"
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Field label="Starts from">
                              <Input
                                type="date"
                                value={startFrom}
                                onChange={(e) => setStartFrom(e.target.value)}
                              />
                            </Field>
                            <Field label="Ends to">
                              <Input
                                type="date"
                                value={endTo}
                                onChange={(e) => setEndTo(e.target.value)}
                              />
                            </Field>
                            {(startFrom || endTo) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  setStartFrom("");
                                  setEndTo("");
                                }}
                              >
                                Clear dates
                              </Button>
                            )}
                          </div>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>

                      {filtersActive && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={clearLocationFilters}>
                            Clear all filters
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {filtersActive && (
                  <p className="text-xs text-muted-foreground">
                    Showing {visibleLocations.length} of {draft.locations.length}{" "}
                    locations
                  </p>
                )}
              </div>
            )}

            {visibleLocations.length === 0 && (
              <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                No locations match these filters.
              </p>
            )}

            {visibleLocations.map(({ l, index: i }) => (
              <div key={i} className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-medium">
                  {l.location || `Location ${i + 1}`}
                  {l.city && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {l.city}
                    </span>
                  )}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Field label="Start date">
                    <Input
                      type="date"
                      value={l.startDate}
                      onChange={(e) =>
                        setLocation(i, { startDate: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Mid date">
                    <Input
                      type="date"
                      value={l.midDate}
                      onChange={(e) =>
                        setLocation(i, { midDate: e.target.value })
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
                  <Field label="Status">
                    <Select
                      value={l.status}
                      onValueChange={(v) =>
                        setLocation(i, { status: v ?? "LIVE" })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(s: string | null) => STATUS_LABELS[s ?? "LIVE"]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LIVE">Live</SelectItem>
                        <SelectItem value="PENDING_CREATIVE">
                          Pending creative
                        </SelectItem>
                        <SelectItem value="ENDED">Ended</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Next reminder">
                    <p className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                      {reminderPreview(l)}
                    </p>
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
              Reminders are sent automatically{" "}
              {EXPIRY_REMINDER_OFFSETS.join(", ")} days before each location&rsquo;s
              end date. Locations left as &ldquo;Pending creative&rdquo; are chased
              daily until their status changes.
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
            {saving
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : mode === "renew"
                  ? "Create renewal"
                  : "Create campaign"}
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
