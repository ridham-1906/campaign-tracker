"use client";

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

export type SimpleComboOption = { id: string; name: string };

/**
 * A plain `{id, name}` picker over a fixed option list — no "create new"
 * affordance, unlike EntityCombobox (which is specific to clients/sales/
 * vendors and bakes in inline creation). Used for picking an existing
 * campaign or location, which are never created from this control.
 */
export function SimpleCombobox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: SimpleComboOption[];
}) {
  const selected = options.find((o) => o.id === value) ?? null;

  return (
    <Combobox
      items={options}
      value={selected}
      itemToStringLabel={(o: SimpleComboOption) => o.name}
      isItemEqualToValue={(a: SimpleComboOption, b: SimpleComboOption) => a.id === b.id}
      onValueChange={(next: SimpleComboOption | null) => onChange(next?.id ?? "")}
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
          {(item: SimpleComboOption) => (
            <ComboboxItem key={item.id} value={item}>
              <ComboboxItemIndicator />
              <span>{item.name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
