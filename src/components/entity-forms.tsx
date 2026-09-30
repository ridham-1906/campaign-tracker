"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useSaveNamed, useSaveSales } from "@/lib/queries/entities";
import { businessToday, formatDate, toDateInputValue } from "@/lib/campaign";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";

export type NamedItem = {
  id: string;
  name: string;
  /** Vendors only. */
  emails?: string[];
  /** Vendors only — yyyy-mm-dd. */
  reminderDates?: string[];
};
export type SalesItem = { id: string; name: string; email: string };

/**
 * Add/edit form for vendors and clients. Clients are name only; vendors also
 * take reminder emails and dates. Reused by the dedicated management pages and
 * by the campaign form's inline "create".
 *
 * The mutation lives in useSaveNamed rather than here, so both callers get the
 * success toast and cache invalidation without having to remember them.
 */
export function NamedResourceForm({
  resource,
  singular,
  editing,
  defaultName,
  onSaved,
  onCancel,
}: {
  resource: "vendors" | "clients";
  singular: string;
  editing?: NamedItem | null;
  defaultName?: string;
  onSaved: (item: NamedItem) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? defaultName ?? "");
  const [emails, setEmails] = useState((editing?.emails ?? []).join(", "));
  const [dates, setDates] = useState<string[]>(editing?.reminderDates ?? []);
  const save = useSaveNamed(resource);
  const isVendor = resource === "vendors";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // onSaved is a local UI concern (close the dialog, select the new
        // option), so it stays at the call site and only fires on success.
        save.mutate(
          {
            id: editing?.id,
            name,
            ...(isVendor && {
              emails: splitEmails(emails),
              reminderDates: dates,
            }),
          },
          { onSuccess: onSaved },
        );
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`${resource}-name`}>Name</Label>
        <Input
          id={`${resource}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${singular} name`}
          required
          autoFocus
        />
      </div>
      {isVendor && (
        <>
          <div className="space-y-2">
            <Label htmlFor="vendors-emails">Reminder emails</Label>
            <Input
              id="vendors-emails"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="ops@vendor.com, owner@vendor.com"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Separate several addresses with commas. Without one,
              this vendor is never emailed.
            </p>
          </div>
          <ReminderDatesField dates={dates} onChange={setDates} />
        </>
      )}
      <DialogFooter>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={save.isPending || !name.trim()}>
          {save.isPending
            ? "Saving…"
            : editing
              ? "Save changes"
              : `Add ${singular.toLowerCase()}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

function splitEmails(raw: string) {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * The calendar days a vendor is emailed on. On each one it gets the status of
 * its live sites, one email per campaign. Past dates are kept (they record what
 * was scheduled) but shown struck through.
 */
function ReminderDatesField({
  dates,
  onChange,
}: {
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
      <Label htmlFor="vendors-date">Reminder dates</Label>
      <div className="flex gap-2">
        <Input
          id="vendors-date"
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
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${
                d < today ? "text-muted-foreground line-through" : ""
              }`}
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
        <p className="text-xs text-muted-foreground">
          No dates — this vendor won&apos;t get automatic reminders.
        </p>
      )}
    </div>
  );
}

/** Add/edit form for sales persons (name + email). Reused by the sales
 * management page and by the campaign form's inline "create". */
export function SalesForm({
  editing,
  defaultName,
  onSaved,
  onCancel,
}: {
  editing?: SalesItem | null;
  defaultName?: string;
  onSaved: (item: SalesItem) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? defaultName ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const save = useSaveSales();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { id: editing?.id, name, email },
          { onSuccess: (saved) => onSaved({ ...saved, email }) },
        );
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="sales-name">Name</Label>
        <Input
          id="sales-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          required
          autoFocus
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sales-email">Email</Label>
        <Input
          id="sales-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          required
        />
      </div>
      <DialogFooter>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={save.isPending || !name.trim() || !email.trim()}
        >
          {save.isPending ? "Saving…" : editing ? "Save changes" : "Add sales person"}
        </Button>
      </DialogFooter>
    </form>
  );
}
