"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { useEntityOptions } from "@/lib/queries/entities";
import { NamedResourceForm, SalesForm } from "@/components/entity-forms";
import {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ComboOption = { id: string; name: string };

type EntityKind = "clients" | "sales" | "vendors";

const KIND_META: Record<EntityKind, { singular: string }> = {
  clients: { singular: "Client" },
  sales: { singular: "Sales person" },
  vendors: { singular: "Vendor" },
};

type ViewItem = ComboOption & { creatable?: string };

export function EntityCombobox({
  kind,
  label,
  value,
  onChange,
}: {
  kind: EntityKind;
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const meta = KIND_META[kind];

  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");

  // Fetched here rather than drilled down from the page, so every consumer of
  // this combobox shares one cache entry per resource.
  const { data: options = [] } = useEntityOptions(kind);

  const selected = options.find((o) => o.id === value) ?? null;

  const trimmed = query.trim();
  const lowered = trimmed.toLocaleLowerCase();
  const exactMatch = options.some(
    (o) => o.name.trim().toLocaleLowerCase() === lowered,
  );
  const items: ViewItem[] =
    trimmed !== "" && !exactMatch
      ? [
          ...options,
          {
            id: `__create__:${lowered}`,
            name: `Create "${trimmed}"`,
            creatable: trimmed,
          },
        ]
      : options;

  function handleCreated(created: ComboOption) {
    // useSaveNamed/useSaveSales already wrote the new record into the options
    // cache, so it's selectable immediately — no local `extras` list needed to
    // bridge the gap until the server list catches up.
    onChange(created.id);
    setQuery("");
    setCreateOpen(false);
  }

  return (
    <>
      <Combobox
        items={items}
        value={selected}
        itemToStringLabel={(o: ViewItem) => o.name}
        isItemEqualToValue={(a: ViewItem, b: ViewItem) => a.id === b.id}
        onValueChange={(next: ViewItem | null) => {
          if (!next) {
            onChange("");
            return;
          }
          if (next.creatable) {
            setPendingName(next.creatable);
            setCreateOpen(true);
            return;
          }
          onChange(next.id);
          setQuery("");
        }}
        onInputValueChange={(next: string) => setQuery(next)}
      >
        <ComboboxInputGroup>
          <ComboboxInput placeholder={`Search ${label.toLowerCase()}…`} />
          <ComboboxClear aria-label="Clear selection" />
          <ComboboxTrigger aria-label="Open suggestions" />
        </ComboboxInputGroup>
        <ComboboxContent>
          <ComboboxEmpty>
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              No {label.toLowerCase()} found.
            </p>
          </ComboboxEmpty>
          <ComboboxList>
            {(item: ViewItem) => (
              <ComboboxItem key={item.id} value={item}>
                {item.creatable ? (
                  <>
                    <PlusIcon />
                    <span>{item.name}</span>
                  </>
                ) : (
                  <>
                    <ComboboxItemIndicator />
                    <span>{item.name}</span>
                  </>
                )}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {meta.singular.toLowerCase()}</DialogTitle>
            {kind === "sales" && (
              <DialogDescription>
                The email is where their campaign reminders are sent.
              </DialogDescription>
            )}
          </DialogHeader>
          {kind === "sales" ? (
            <SalesForm
              key={pendingName}
              defaultName={pendingName}
              onSaved={handleCreated}
              onCancel={() => setCreateOpen(false)}
            />
          ) : (
            <NamedResourceForm
              key={pendingName}
              resource={kind}
              singular={meta.singular}
              defaultName={pendingName}
              onSaved={handleCreated}
              onCancel={() => setCreateOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
