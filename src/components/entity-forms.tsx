"use client";

import { useState } from "react";
import { useSaveNamed, useSaveSales } from "@/lib/queries/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";

export type NamedItem = { id: string; name: string };
export type SalesItem = { id: string; name: string; email: string };

/**
 * Add/edit form for vendors and clients (name only). Reused by the dedicated
 * management pages and by the campaign form's inline "create".
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
  const save = useSaveNamed(resource);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // onSaved is a local UI concern (close the dialog, select the new
        // option), so it stays at the call site and only fires on success.
        save.mutate({ id: editing?.id, name }, { onSuccess: onSaved });
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
