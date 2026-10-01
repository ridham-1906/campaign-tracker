"use client";

import { useState } from "react";
import { useSaveNamed, useSaveSales } from "@/lib/queries/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";

export type NamedItem = {
  id: string;
  name: string;
  /** Vendors only. */
  emails?: string[];
};
export type SalesItem = { id: string; name: string; email: string };

/**
 * Add/edit form for vendors and clients — both name only, vendors also take
 * reminder emails. Reused by the dedicated management pages and by the
 * campaign form's inline "create".
 *
 * Vendor emails are the only thing stored on the vendor itself — there's no
 * schedule here. Every vendor email is a manual "Remind vendor" send from the
 * campaign screen; see lib/reminders/vendor.ts.
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
            ...(isVendor && { emails: splitEmails(emails) }),
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
