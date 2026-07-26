"use client";

import { SimpleCombobox } from "@/components/simple-combobox";
import { Label } from "@/components/ui/label";
import type { LocationView } from "@/lib/view-types";

/**
 * Pick which location's files to browse. Every location is listed with its file
 * count, empty ones included — hiding them would misrepresent the campaign.
 * Choosing one opens the gallery straight away.
 */
export function LocationStep({
  locations,
  onSelect,
}: {
  locations: LocationView[];
  onSelect: (locationId: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Location</Label>
      <SimpleCombobox
        label="locations"
        value=""
        onChange={(id) => id && onSelect(id)}
        options={locations.map((l) => ({
          id: l.id,
          name: `${l.location} · ${l.city} (${l.attachments.length})`,
        }))}
      />
    </div>
  );
}
