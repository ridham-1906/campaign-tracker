"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { useCreateImageType, useImageTypeOptions } from "@/lib/queries/image-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Sentinel item value for "Add custom type" — never a real ImageType id
 * (those are ObjectId hex strings), so it can't collide with one. */
const ADD_CUSTOM_VALUE = "__add_custom_type__";

/**
 * "Type of image" picker: a select over the user's DB-backed image types
 * (Installation/Mid date/End date, seeded automatically, plus whatever
 * custom types they've added), with "Add custom type" as an item at the
 * bottom of the same dropdown. Picking it reveals a small inline input right
 * below the select; confirming saves the name once and selects it — from
 * then on it's just another option in this list, for this upload and every
 * one after.
 *
 * Images only — a creative deck isn't an image type, it's a different `kind`
 * entirely, so callers that let the user upload one handle that as its own
 * toggle rather than an entry in this list.
 */
export function ImageTypePicker({
  value,
  onChange,
  disabled,
}: {
  /** An ImageType id. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { data: options = [], isLoading } = useImageTypeOptions();
  const createType = useCreateImageType();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  function submitCustom() {
    const trimmed = name.trim();
    if (!trimmed || createType.isPending) return;
    createType.mutate(trimmed, {
      onSuccess: (created) => {
        onChange(created.id);
        setName("");
        setAdding(false);
      },
    });
  }

  return (
    <div className="space-y-1.5">
      <Select
        value={value}
        disabled={disabled || isLoading}
        onValueChange={(v) => {
          if (!v) return;
          if (v === ADD_CUSTOM_VALUE) {
            setAdding(true);
            return;
          }
          onChange(v);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(v: string | null) =>
              options.find((o) => o.id === v)?.name ?? (isLoading ? "Loading…" : "Select a type")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={ADD_CUSTOM_VALUE}>
            <PlusIcon className="size-3.5" />
            Add custom type
          </SelectItem>
        </SelectContent>
      </Select>

      {adding && (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New type name…"
            disabled={createType.isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitCustom();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || createType.isPending}
            onClick={submitCustom}
          >
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel"
            disabled={createType.isPending}
            onClick={() => {
              setAdding(false);
              setName("");
            }}
          >
            <XIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
