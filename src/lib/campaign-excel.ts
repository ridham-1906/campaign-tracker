"use client";

import { toDateInputValue } from "@/lib/campaign";
import type { LocationDraft } from "@/components/campaign-form";
import type { OptionView } from "@/lib/view-types";

export type CampaignExcelImport = {
  locations: LocationDraft[];
  warnings: string[];
  sheetName: string;
};

type RowValue = string | number | boolean | Date | null | undefined;
type Row = RowValue[];

const HEADER_ALIASES = {
  vendor: ["vendor", "vendor name"],
  status: ["status", "stratus"],
  city: ["city"],
  type: ["type", "media type"],
  location: ["location", "area", "site", "site location"],
  startDate: ["start date", "start", "from date", "from"],
  // Optional — several sheets don't have this column at all.
  midDate: ["mid date", "middate", "mid"],
  endDate: ["end date", "end", "enddate", "to date", "to"],
} as const;

const REQUIRED_FIELDS = [
  "vendor",
  "city",
  "type",
  "location",
  "startDate",
  "endDate",
] as const;

const MONTHS = new Map([
  ["jan", 0],
  ["feb", 1],
  ["mar", 2],
  ["apr", 3],
  ["may", 4],
  ["jun", 5],
  ["jul", 6],
  ["aug", 7],
  ["sep", 8],
  ["sept", 8],
  ["oct", 9],
  ["nov", 10],
  ["dec", 11],
]);

function normalize(value: RowValue) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeKey(value: RowValue) {
  return normalize(value).replace(/[^a-z0-9]/g, "");
}

function text(value: RowValue) {
  return String(value ?? "").trim();
}

function isEmptyRow(row: Row) {
  return row.every((cell) => !text(cell));
}

function findHeaderRow(rows: Row[]) {
  let bestIndex = -1;
  let bestScore = 0;
  let bestMap = new Map<keyof typeof HEADER_ALIASES, number>();

  rows.slice(0, 25).forEach((row, index) => {
    const map = new Map<keyof typeof HEADER_ALIASES, number>();
    row.forEach((cell, columnIndex) => {
      const key = normalizeKey(cell);
      (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).forEach(
        (field) => {
          if (
            !map.has(field) &&
            HEADER_ALIASES[field].some((alias) => normalizeKey(alias) === key)
          ) {
            map.set(field, columnIndex);
          }
        },
      );
    });

    if (map.size > bestScore) {
      bestIndex = index;
      bestScore = map.size;
      bestMap = map;
    }
  });

  return { index: bestIndex, columns: bestMap, score: bestScore };
}

function excelSerialToDate(serial: number) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const date = new Date(utcValue * 1000);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(value: RowValue) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateInputValue(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return toDateInputValue(excelSerialToDate(value));
  }

  const raw = text(value).replace(/^'+/, "").replace(/\s+/g, "");
  if (!raw) return "";

  const cleaned = raw.replace(/[.]/g, "/");
  const dayMonth = cleaned.match(/^(\d{1,2})[-/ ]([a-zA-Z]{3,})$/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS.get(dayMonth[2].slice(0, 4).toLowerCase());
    const year = new Date().getFullYear();
    if (month !== undefined) {
      const date = new Date(year, month, day);
      if (
        date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day
      ) {
        return toDateInputValue(date);
      }
    }
  }

  const parts = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (parts) {
    const day = Number(parts[1]);
    const month = Number(parts[2]);
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return toDateInputValue(date);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : toDateInputValue(parsed);
}

function normalizeStatus(value: RowValue) {
  const status = normalize(value);
  if (!status) return "PENDING_CREATIVE";
  if (status === "ended" || status === "end" || status === "completed") {
    return "ENDED";
  }
  return "LIVE";
}

function emptyImportLocation(): LocationDraft {
  return {
    city: "",
    location: "",
    type: "",
    vendorId: "",
    startDate: "",
    midDate: "",
    endDate: "",
    status: "LIVE",
  };
}

function getCell(row: Row, columns: Map<keyof typeof HEADER_ALIASES, number>, key: keyof typeof HEADER_ALIASES) {
  const column = columns.get(key);
  return column === undefined ? "" : row[column];
}

export async function parseCampaignExcel(
  file: File,
  vendors: OptionView[],
): Promise<CampaignExcelImport> {
  const XLSX = await import("xlsx");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { cellDates: false });
  const vendorByName = new Map(vendors.map((v) => [normalize(v.name), v.id]));
  const warnings: string[] = [];

  let selected:
    | { sheetName: string; rows: Row[]; header: ReturnType<typeof findHeaderRow> }
    | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
      header: 1,
      raw: true,
      blankrows: false,
    });
    const header = findHeaderRow(rows);
    if (!selected || header.score > selected.header.score) {
      selected = { sheetName, rows, header };
    }
  }

  if (!selected || selected.header.score < 4) {
    return {
      locations: [],
      warnings: [
        "Could not find enough columns. Expected Vendor, City, Type, Location, Start date and End date.",
      ],
      sheetName: "",
    };
  }

  const missingHeaders = REQUIRED_FIELDS.filter(
    (field) => !selected.header.columns.has(field),
  );
  if (missingHeaders.length > 0) {
    warnings.push(`Missing columns: ${missingHeaders.join(", ")}.`);
  }

  const locations: LocationDraft[] = [];
  const dataRows = selected.rows.slice(selected.header.index + 1);

  dataRows.forEach((row, rowIndex) => {
    if (isEmptyRow(row)) return;

    const excelRow = selected!.header.index + rowIndex + 2;
    const vendorName = text(getCell(row, selected!.header.columns, "vendor"));
    const startDate = parseDate(getCell(row, selected!.header.columns, "startDate"));
    const midDate = parseDate(getCell(row, selected!.header.columns, "midDate"));
    const endDate = parseDate(getCell(row, selected!.header.columns, "endDate"));
    const vendorId = vendorByName.get(normalize(vendorName)) ?? "";

    const location: LocationDraft = {
      ...emptyImportLocation(),
      city: text(getCell(row, selected!.header.columns, "city")),
      location: text(getCell(row, selected!.header.columns, "location")),
      type: text(getCell(row, selected!.header.columns, "type")),
      vendorId,
      startDate,
      midDate,
      endDate,
      status: normalizeStatus(getCell(row, selected!.header.columns, "status")),
    };

    const hasUsefulData =
      location.city ||
      location.location ||
      location.type ||
      vendorName ||
      startDate ||
      endDate;
    if (!hasUsefulData) return;

    if (vendorName && !vendorId) {
      warnings.push(`Row ${excelRow}: vendor "${vendorName}" is not in vendors yet.`);
    }
    if (!location.city) warnings.push(`Row ${excelRow}: city is empty.`);
    if (!location.location) warnings.push(`Row ${excelRow}: location is empty.`);
    if (!location.type) warnings.push(`Row ${excelRow}: type is empty.`);
    if (!startDate) warnings.push(`Row ${excelRow}: start date is missing or invalid.`);
    if (!endDate) warnings.push(`Row ${excelRow}: end date is missing or invalid.`);
    if (startDate && endDate && endDate < startDate) {
      warnings.push(`Row ${excelRow}: end date is before start date.`);
    }

    locations.push(location);
  });

  if (locations.length === 0) {
    warnings.push("No campaign location rows were found in the selected sheet.");
  }

  return { locations, warnings, sheetName: selected.sheetName };
}
