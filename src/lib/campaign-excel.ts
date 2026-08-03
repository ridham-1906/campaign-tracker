"use client";

import { toDateInputValue } from "@/lib/campaign";
import type { LocationDraft } from "@/components/campaign-form";
import type { OptionView } from "@/lib/view-types";

export type CampaignExcelImport = {
  locations: LocationDraft[];
  /** Campaign-wide, so it's read once from the sheet rather than per row. */
  category: string;
  warnings: string[];
  sheetName: string;
};

type RowValue = string | number | boolean | Date | null | undefined;
type Row = RowValue[];

const HEADER_ALIASES = {
  vendor: ["vendor", "vendor name"],
  status: ["status", "stratus"],
  city: ["city"],
  // The media format. Sheets used to call this column "Type"; once they grew a
  // separate illumination column they renamed it MEDIUM, and `type` below took
  // over the old name. See the legacy fallback in parseCampaignExcel.
  medium: ["medium", "media type"],
  type: ["type", "lighting", "illumination"],
  width: ["w", "width"],
  height: ["h", "height"],
  sqft: ["sqft", "sq ft", "area"],
  category: ["category"],
  location: ["location", "area", "site", "site location"],
  startDate: ["start date", "start", "from date", "from"],
  // Optional — several sheets don't have this column at all.
  midDate: ["mid date", "middate", "mid"],
  endDate: ["end date", "end", "enddate", "to date", "to"],
} as const;

const REQUIRED_FIELDS = [
  "vendor",
  "city",
  "medium",
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
  // Already midnight UTC, which is what toDateInputValue reads. Rebuilding it
  // through the local-time constructor shifted the whole thing a day back east
  // of Greenwich — an Indian sheet imported every date one day early.
  return new Date(utcValue * 1000);
}

function parseDate(value: RowValue) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toDateInputValue(value);
  }

  // A 0 in a date column means "blank" in every sheet we've seen, but serial 0
  // is a real date (1899-12-30) — and falling through to the text parsing below
  // is worse still, since `new Date("0")` lands in 2000. Either way it would be
  // a bogus date accepted without a warning, so bail out here.
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 ? toDateInputValue(excelSerialToDate(value)) : "";
  }

  const raw = text(value).replace(/^'+/, "").replace(/\s+/g, "");
  if (!raw) return "";
  // Same cell, stored as text rather than a number.
  if (/^-?\d+(\.\d+)?$/.test(raw) && Number(raw) <= 0) return "";

  const cleaned = raw.replace(/[.]/g, "/");
  const dayMonth = cleaned.match(/^(\d{1,2})[-/ ]([a-zA-Z]{3,})$/);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const month = MONTHS.get(dayMonth[2].slice(0, 4).toLowerCase());
    const year = new Date().getFullYear();
    if (month !== undefined) {
      // UTC throughout — see excelSerialToDate. The round-trip check also has
      // to read UTC, or it rejects valid dates in a negative-offset zone.
      const date = new Date(Date.UTC(year, month, day));
      if (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month &&
        date.getUTCDate() === day
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
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
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

/**
 * A dimension cell as the form holds it — a string. Blank and non-numeric cells
 * both become "", so a stray "N/A" never lands in a number field.
 *
 * 0 is treated as blank too: no site is zero feet wide, and the sheet's SQFT
 * column is a `= W * H` formula that yields 0 on every row where W and H are
 * empty. Importing those as a literal 0 would fill the form with false data.
 */
function numberText(value: RowValue) {
  const raw = text(value);
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function emptyImportLocation(): LocationDraft {
  return {
    city: "",
    location: "",
    medium: "",
    vendorId: "",
    type: "",
    width: "",
    height: "",
    sqft: "",
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
      category: "",
      warnings: [
        "Could not find enough columns. Expected Vendor, City, Medium, Location, Start date and End date.",
      ],
      sheetName: "",
    };
  }

  // Older sheets carry the media format in a column called "Type" and have no
  // MEDIUM at all. Read that column as the medium, and leave illumination
  // unset — otherwise every sheet written before the rename imports with a
  // blank medium and "Billboard" filed as its lighting.
  const columns = selected.header.columns;
  if (!columns.has("medium") && columns.has("type")) {
    columns.set("medium", columns.get("type")!);
    columns.delete("type");
  }

  const missingHeaders = REQUIRED_FIELDS.filter(
    (field) => !selected.header.columns.has(field),
  );
  if (missingHeaders.length > 0) {
    warnings.push(`Missing columns: ${missingHeaders.join(", ")}.`);
  }

  const locations: LocationDraft[] = [];
  // Campaign-wide: the first row that fills it in wins, and the rest of the
  // column is ignored rather than warned about — the sheet repeats one value.
  let category = "";
  const dataRows = selected.rows.slice(selected.header.index + 1);

  dataRows.forEach((row, rowIndex) => {
    if (isEmptyRow(row)) return;

    const excelRow = selected!.header.index + rowIndex + 2;
    const vendorName = text(getCell(row, selected!.header.columns, "vendor"));
    const startDate = parseDate(getCell(row, selected!.header.columns, "startDate"));
    const midDate = parseDate(getCell(row, selected!.header.columns, "midDate"));
    const endDate = parseDate(getCell(row, selected!.header.columns, "endDate"));
    const vendorId = vendorByName.get(normalize(vendorName)) ?? "";

    const width = numberText(getCell(row, selected!.header.columns, "width"));
    const height = numberText(getCell(row, selected!.header.columns, "height"));
    // The sheet computes SQFT with `= W * H`, so the parsed cell already holds
    // the product. Derive it only when the column is absent or blank.
    const sqft = numberText(getCell(row, selected!.header.columns, "sqft"));

    const location: LocationDraft = {
      ...emptyImportLocation(),
      city: text(getCell(row, selected!.header.columns, "city")),
      location: text(getCell(row, selected!.header.columns, "location")),
      medium: text(getCell(row, selected!.header.columns, "medium")),
      type: text(getCell(row, selected!.header.columns, "type")),
      width,
      height,
      sqft: sqft || (width && height ? String(Number(width) * Number(height)) : ""),
      vendorId,
      startDate,
      midDate,
      endDate,
      status: normalizeStatus(getCell(row, selected!.header.columns, "status")),
    };

    const hasUsefulData =
      location.city ||
      location.location ||
      location.medium ||
      vendorName ||
      startDate ||
      endDate;
    if (!hasUsefulData) return;

    if (!category) {
      category = text(getCell(row, selected!.header.columns, "category"));
    }

    if (vendorName && !vendorId) {
      warnings.push(`Row ${excelRow}: vendor "${vendorName}" is not in vendors yet.`);
    }
    if (!location.city) warnings.push(`Row ${excelRow}: city is empty.`);
    if (!location.location) warnings.push(`Row ${excelRow}: location is empty.`);
    if (!location.medium) warnings.push(`Row ${excelRow}: medium is empty.`);
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

  return { locations, category, warnings, sheetName: selected.sheetName };
}
