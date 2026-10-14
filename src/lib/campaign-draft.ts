// Shared between the Campaigns list (campaign-manager.tsx) and the single
// campaign page (campaign-detail.tsx) — both turn a fetched campaign into an
// editable CampaignDraft, so the conversion lives here once rather than twice.

import { addDays, businessToday, startOfDay, toDateInputValue } from "@/lib/campaign";
import type { CampaignDraft, LocationDraft } from "@/components/campaign-form";

/** The fields toDraft()/renewalDraft() actually read — satisfied by both the
 * list's CampaignListView and the detail page's full CampaignView, so either
 * can be passed in without one depending on the other's shape. */
export type DraftSource = {
  client: { id: string };
  sales: { id: string };
  category: string;
  locations: {
    id: string;
    city: string;
    location: string;
    medium: string;
    type: string;
    width: number | null;
    height: number | null;
    sqft: number | null;
    vendor: { id: string };
    startDate: string | Date;
    midDate: string | Date | null;
    endDate: string | Date;
    status: string;
  }[];
};

/** Dimensions are numbers on the wire and `<Input>` strings in the draft. */
function sizeText(v: number | null) {
  return v == null ? "" : String(v);
}

export function toDraft(c: DraftSource): CampaignDraft {
  return {
    clientId: c.client.id,
    salesId: c.sales.id,
    category: c.category,
    locations: c.locations.map(
      (l): LocationDraft => ({
        id: l.id,
        city: l.city,
        location: l.location,
        medium: l.medium,
        type: l.type,
        width: sizeText(l.width),
        height: sizeText(l.height),
        sqft: sizeText(l.sqft),
        vendorId: l.vendor.id,
        startDate: toDateInputValue(l.startDate),
        midDate: l.midDate ? toDateInputValue(l.midDate) : "",
        endDate: toDateInputValue(l.endDate),
        status: l.status,
      }),
    ),
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * A renewal moves the *same* campaign into its next booking term — it does not
 * write a second one. Location ids are therefore kept, not dropped: the server
 * archives the outgoing dates against those ids, and every photo already
 * uploaded stays on the campaign, tagged with the term it was taken under.
 *
 * Each location is shifted on its own, keeping its original length, so a
 * campaign whose placements ran to different end dates renews as the same
 * staggered set rather than being flattened onto one term. The new term starts
 * the day after the old one ended — or today, if that has already passed, so
 * renewing a long-expired campaign never proposes dates in the past.
 *
 * Every status resets to LIVE: a renewal is a fresh booking, not a
 * continuation of whatever state the last one finished in.
 */
export function renewalDraft(c: DraftSource): CampaignDraft {
  const today = businessToday();

  return {
    clientId: c.client.id,
    salesId: c.sales.id,
    category: c.category,
    locations: c.locations.map((l): LocationDraft => {
      const oldStart = startOfDay(new Date(l.startDate));
      const oldEnd = startOfDay(new Date(l.endDate));
      const start = new Date(
        Math.max(addDays(oldEnd, 1).getTime(), today.getTime()),
      );
      const shift = Math.round((start.getTime() - oldStart.getTime()) / MS_PER_DAY);

      return {
        id: l.id,
        city: l.city,
        location: l.location,
        medium: l.medium,
        type: l.type,
        width: sizeText(l.width),
        height: sizeText(l.height),
        sqft: sizeText(l.sqft),
        vendorId: l.vendor.id,
        startDate: toDateInputValue(start),
        midDate: l.midDate
          ? toDateInputValue(addDays(startOfDay(new Date(l.midDate)), shift))
          : "",
        endDate: toDateInputValue(addDays(oldEnd, shift)),
        status: "LIVE",
      };
    }),
  };
}

/** The location fields as both the create and update endpoints want them. */
export function locationPayload(l: LocationDraft) {
  return {
    ...(l.id ? { id: l.id } : {}),
    city: l.city,
    location: l.location,
    medium: l.medium,
    // Sent as the raw input strings — the API's zod schema coerces them and
    // turns "" into "not set" rather than 0.
    type: l.type,
    width: l.width,
    height: l.height,
    sqft: l.sqft,
    vendorId: l.vendorId,
    startDate: l.startDate,
    midDate: l.midDate,
    endDate: l.endDate,
    status: l.status,
  };
}
