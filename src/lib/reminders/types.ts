import "server-only";
import type { AnyBulkWriteOperation, Types } from "mongoose";
import type { MailMessage } from "@/lib/mail/shared";

/** Only the location fields the emails need — attachments stay in Mongo. */
export type DueLocation = {
  _id: Types.ObjectId;
  city: string;
  location: string;
  type: string;
  startDate: Date;
  endDate: Date;
};

export type Person = { name: string; email: string };

/** One campaign with the locations a single reminder kind must email about. */
export type Job = {
  _id: Types.ObjectId;
  locations: DueLocation[];
  sales?: Person;
  client?: { name: string };
  owner?: { _id: Types.ObjectId } & Person & { appPassword: string };
};

/** Day boundaries a kind builds its query from, all in the business timezone. */
export type Window = {
  /** Midnight today. */
  dayStart: Date;
  /** Midnight tomorrow. */
  dayEnd: Date;
  /** The furthest end date any reminder cares about. */
  windowEnd: Date;
};

export type MessageInput = {
  fromName: string;
  salesName: string;
  clientName: string;
  locations: DueLocation[];
  now: Date;
};

/**
 * Everything that differs between reminder types. The runner supplies the
 * scheduling, sending and bookkeeping around it.
 */
export type ReminderKind = {
  /** Appears in logs and in the run result. */
  name: string;
  /** Index-backed narrowing, applied before locations are inspected. */
  match(w: Window): Record<string, unknown>;
  /** `$filter` condition picking the locations that are due. */
  cond(w: Window): Record<string, unknown>;
  /** Compose one campaign's email. */
  message(input: MessageInput): MailMessage;
  /** Record that those locations were emailed. */
  mark(
    campaignId: Types.ObjectId,
    locations: DueLocation[],
    sentAt: Date,
    now: Date,
  ): AnyBulkWriteOperation[];
};

export type ReminderRunResult = {
  kind: string;
  date: string;
  /** Campaigns with at least one due location. */
  due: number;
  /** Emails actually sent. */
  sent: number;
  /** Locations covered by those emails. */
  locationsSent: number;
  skipped: number;
  /** Left unsent because the run ran out of time; retried on the next run. */
  deferred: number;
  errors: { campaignId: string; error: string }[];
};
