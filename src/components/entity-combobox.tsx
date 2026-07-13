"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
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
  options,
}: {
  kind: EntityKind;
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: ComboOption[];
}) {
  const router = useRouter();
  const meta = KIND_META[kind];

  const [extras, setExtras] = useState<ComboOption[]>([]);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");

  const allOptions = useMemo(() => {
    const merged = [...options];
    for (const extra of extras) {
      if (!merged.some((o) => o.id === extra.id)) merged.push(extra);
    }
    return merged;
  }, [options, extras]);

  const selected = allOptions.find((o) => o.id === value) ?? null;

  const trimmed = query.trim();
  const lowered = trimmed.toLocaleLowerCase();
  const exactMatch = allOptions.some(
    (o) => o.name.trim().toLocaleLowerCase() === lowered,
  );
  const items: ViewItem[] =
    trimmed !== "" && !exactMatch
      ? [
          ...allOptions,
          {
            id: `__create__:${lowered}`,
            name: `Create "${trimmed}"`,
            creatable: trimmed,
          },
        ]
      : allOptions;

  function handleCreated(created: ComboOption) {
    setExtras((prev) => [...prev, created]);
    onChange(created.id);
    setQuery("");
    setCreateOpen(false);
    router.refresh();
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
