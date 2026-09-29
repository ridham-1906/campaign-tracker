// Matches a dropped folder's name against known locations, and a file's name
// against a photo category, for the folder-upload wizard. Pure,
// dependency-free string matching — see components/folder-upload-wizard.tsx
// for how the result is used.

import type { PhotoType } from "@/lib/attachments";
import type { LocationIndexEntry } from "@/lib/view-types";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient over character bigrams — tolerant of word-order
 * and spacing/punctuation differences between a folder name and a stored
 * location name (e.g. "Andheri_West-Mumbai" vs "Andheri West · Mumbai"),
 * without pulling in a fuzzy-matching dependency. */
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const remaining = new Map<string, number>();
  for (const bg of bigrams(a)) remaining.set(bg, (remaining.get(bg) ?? 0) + 1);

  let intersection = 0;
  const bigramsB = bigrams(b);
  for (const bg of bigramsB) {
    const count = remaining.get(bg) ?? 0;
    if (count > 0) {
      intersection++;
      remaining.set(bg, count - 1);
    }
  }
  return (2 * intersection) / (bigrams(a).length + bigramsB.length);
}

export type FolderMatch = {
  entry: LocationIndexEntry;
  score: number;
};

// A match below this score is too weak to trust automatically.
const CONFIDENCE_THRESHOLD = 0.5;
// The lead the best match needs over the runner-up to count as unambiguous —
// otherwise two similarly-named locations could silently swap.
const AMBIGUITY_GAP = 0.15;

/**
 * Scores one or more name variants for the same folder against every known
 * (campaign, location) and returns the best match only when it's both
 * confident and clearly ahead of the runner-up. Returns null otherwise, so
 * the caller falls back to asking the user to pick manually rather than
 * guessing wrong.
 *
 * Multiple variants let the caller offer both a location's bare name (e.g.
 * "Ambegaon D-Mart") and one qualified with its parent folder (e.g. "Redcliff
 * Ambegaon D-Mart") — real exports nest locations under a client folder, and
 * trying both catches whichever one the stored location/client names line up
 * with best.
 */
export function matchFolderName(
  nameOrVariants: string | string[],
  index: LocationIndexEntry[],
): FolderMatch | null {
  const variants = (Array.isArray(nameOrVariants) ? nameOrVariants : [nameOrVariants])
    .map(normalize)
    .filter(Boolean);
  if (variants.length === 0 || index.length === 0) return null;

  const scored = index
    .map((entry) => {
      const candidates = [
        entry.location,
        `${entry.location} ${entry.city}`,
        `${entry.clientName} ${entry.location}`,
        `${entry.clientName} ${entry.location} ${entry.city}`,
      ].map(normalize);
      const score = Math.max(
        ...variants.flatMap((needle) =>
          candidates.map((candidate) => diceCoefficient(needle, candidate)),
        ),
      );
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score);

  const [best, second] = scored;
  if (!best || best.score < CONFIDENCE_THRESHOLD) return null;
  if (second && best.score - second.score < AMBIGUITY_GAP) return null;

  return best;
}

/**
 * Strips a leading list-position marker like "1. ", "10) " or "3 - " off a
 * folder name — vendors commonly export location folders numbered that way,
 * and the number would otherwise swamp the name-similarity score.
 */
export function stripOrdinalPrefix(name: string): string {
  return name.replace(/^\s*\d+\s*[.)-]\s*/, "").trim();
}

/** Recognised spellings (after lowercasing/stripping spaces) for each photo
 * category — field exports name files after the shot type directly (e.g.
 * "GPS.jpeg", "Normal.jpeg") rather than using our internal enum values. */
const PHOTO_TYPE_ALIASES: Record<string, PhotoType> = {
  gps: "gps",
  location: "gps",
  geotag: "gps",
  newspaper: "newspaper",
  paper: "newspaper",
  print: "newspaper",
  longshot: "long_shot",
  long: "long_shot",
  normal: "long_shot",
  wide: "long_shot",
  fullshot: "long_shot",
  closeshot: "close_shot",
  close: "close_shot",
  zoom: "close_shot",
  closeup: "close_shot",
};

/** Guesses a photo category from a filename (extension ignored) — e.g.
 * "Normal.jpeg" → "long_shot". Returns null when nothing recognisable
 * matches, so the caller can fall back to asking. */
export function inferPhotoType(filename: string): PhotoType | null {
  const base = filename.replace(/\.[^./\\]+$/, "");
  const key = normalize(base).replace(/\s+/g, "");
  return PHOTO_TYPE_ALIASES[key] ?? null;
}
