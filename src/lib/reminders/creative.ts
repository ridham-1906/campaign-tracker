import "server-only";
import { buildCreativeReminder } from "@/lib/mail/creative-reminder";
import type { ReminderKind } from "./types";

/**
 * A daily nudge for every location still sitting on PENDING_CREATIVE, until the
 * status changes or its end date passes. Unlike expiry reminders there is no
 * schedule to advance — only the last send date, so it repeats each day.
 */
export const creativeReminders: ReminderKind = {
  name: "creative",

  match: ({ dayStart }) => ({
    locations: {
      $elemMatch: {
        status: "PENDING_CREATIVE",
        endDate: { $gte: dayStart },
      },
    },
  }),

  cond: ({ dayStart }) => ({
    $and: [
      { $eq: ["$$l.status", "PENDING_CREATIVE"] },
      { $gte: ["$$l.endDate", dayStart] },
      {
        $or: [
          { $eq: ["$$l.creativeReminderSentAt", null] },
          { $lt: ["$$l.creativeReminderSentAt", dayStart] },
        ],
      },
    ],
  }),

  message: ({ fromName, salesName, clientName, locations }) =>
    buildCreativeReminder({
      fromName,
      salesName,
      clientName,
      locations: locations.map((l) => ({
        location: l.location,
        city: l.city,
        medium: l.medium,
        startDate: new Date(l.startDate),
        endDate: new Date(l.endDate),
      })),
    }),

  // Every location gets the same stamp, so one op covers them all.
  mark: (campaignId, locations, sentAt) => [
    {
      updateOne: {
        filter: { _id: campaignId },
        update: { $set: { "locations.$[loc].creativeReminderSentAt": sentAt } },
        arrayFilters: [{ "loc._id": { $in: locations.map((l) => l._id) } }],
      },
    },
  ],
};
