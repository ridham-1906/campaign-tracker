import "server-only";
import type { AnyBulkWriteOperation } from "mongoose";
import { buildExpiryReminder } from "@/lib/mail/expiry-reminder";
import { addDays, daysUntil, reminderScheduleFor } from "@/lib/campaign";
import type { ReminderKind } from "./types";

/**
 * Escalating reminders before a location's end date, at the offsets in
 * EXPIRY_REMINDER_OFFSETS. `reminderDate` holds the next one due and rolls
 * forward after each send.
 *
 * Pending-creative locations are included: their end date runs down whether or
 * not the creative arrived.
 */
export const expiryReminders: ReminderKind = {
  name: "expiry",

  match: ({ dayStart, dayEnd }) => ({
    locations: {
      $elemMatch: {
        reminderDate: { $lt: dayEnd },
        endDate: { $gte: dayStart },
      },
    },
  }),

  // `reminderSent` is deliberately not consulted: dedupe is by
  // `reminderSentAt`, which lets pre-series documents heal themselves.
  cond: ({ dayStart, dayEnd, windowEnd }) => ({
    $and: [
      { $ne: ["$$l.status", "ENDED"] },
      { $gte: ["$$l.endDate", dayStart] },
      { $lte: ["$$l.endDate", windowEnd] },
      { $lt: ["$$l.reminderDate", dayEnd] },
      {
        $or: [
          { $eq: ["$$l.reminderSentAt", null] },
          { $lt: ["$$l.reminderSentAt", dayStart] },
        ],
      },
    ],
  }),

  message: ({ fromName, salesName, clientName, locations, now }) =>
    buildExpiryReminder({
      fromName,
      salesName,
      clientName,
      locations: locations.map((l) => ({
        location: l.location,
        city: l.city,
        medium: l.medium,
        endDate: new Date(l.endDate),
        daysLeft: Math.max(0, daysUntil(new Date(l.endDate), now)),
      })),
    }),

  // Each location advances to its own next milestone, so this is one op each.
  // `now + 1 day` guarantees the milestone that just fired can't re-fire today.
  mark: (campaignId, locations, sentAt, now) => {
    const from = addDays(now, 1);
    return locations.map((l): AnyBulkWriteOperation => {
      const next = reminderScheduleFor(new Date(l.endDate), from);
      return {
        updateOne: {
          filter: { _id: campaignId },
          update: {
            $set: {
              "locations.$[loc].reminderDate": next.reminderDate,
              "locations.$[loc].reminderSent": next.reminderSent,
              "locations.$[loc].reminderSentAt": sentAt,
            },
          },
          arrayFilters: [{ "loc._id": l._id }],
        },
      };
    });
  },
};
