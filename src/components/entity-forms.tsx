"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiError, apiFetch } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogFooter } from "@/components/ui/dialog";

export type NamedItem = { id: string; name: string };
export type SalesItem = { id: string; name: string; email: string };

/** Add/edit form for vendors and clients (name only). Reused by the
 * dedicated management pages and by the campaign form's inline "create". */
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
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = editing
      ? await apiFetch<NamedItem>(`/api/${resource}/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        })
      : await apiFetch<NamedItem>(`/api/${resource}`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
    setSaving(false);
    if (!res.ok) return toast.error(apiError(res.data));
    toast.success(`${singular} ${editing ? "updated" : "added"}`);
    onSaved(res.data);
  }

  return (
    <form onSubmit={save} className="space-y-4">
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
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving
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
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = JSON.stringify({ name, email });
    const res = editing
      ? await apiFetch<SalesItem>(`/api/sales/${editing.id}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch<SalesItem>(`/api/sales`, { method: "POST", body: payload });
    setSaving(false);
    if (!res.ok) return toast.error(apiError(res.data));
    toast.success(`Sales person ${editing ? "updated" : "added"}`);
    onSaved(res.data);
  }

  return (
    <form onSubmit={save} className="space-y-4">
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
          disabled={saving || !name.trim() || !email.trim()}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Add sales person"}
        </Button>
      </DialogFooter>
    </form>
  );
}
