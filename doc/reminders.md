# Reminders

The core feature: sales people are emailed automatically about campaigns that
are ending, and chased daily about locations still waiting on their creative.

Reminders live on each **campaign location**, not on the campaign — a campaign
runs at several sites with their own start/end dates, and each is reminded about
independently. One email covers all of a campaign's due locations.

## Expiry reminders

Every location is reminded about **7, 5, 3, 2 and 1 days before its end date**.
There is no editable reminder date; the schedule is derived from the end date.

- `reminderDate` holds the **next** reminder due. After each send it rolls
  forward to the next milestone. Once the series is exhausted it is parked one
  day past the end date and `reminderSent` is set to `true`.
- `reminderSentAt` is the dedupe key: a location is emailed at most once a day.
- A milestone that is missed (job didn't run, send failed) is **caught up** on
  the next run, using the real days-left at that moment rather than the
  milestone that was missed.

Locations marked **Pending creative** still receive expiry reminders — their end
date is running down regardless of whether the creative arrived.

## Creative reminders

Any location whose status is `PENDING_CREATIVE` and whose end date hasn't passed
is chased **every day** until the status changes, tracked by
`creativeReminderSentAt`. This is a separate email from the expiry reminder; a
campaign can receive both on the same day.

## The job

`/api/cron/reminders` (see [Admin API](./api.md)) does the whole pass:

1. **Plan** — one MongoDB aggregation filters and projects server-side, so only
   the locations that actually need an email come back, with only their mailable
   fields. Sales person, client and owning user are joined in the same query.
2. **Send** — jobs are grouped by owning user and sent from that user's own
   Gmail over a single pooled connection, a bounded number of users at a time.
3. **Record** — each campaign's sends are written back immediately with a
   targeted `bulkWrite` touching only the affected location fields.

**Idempotent:** sends are recorded per location, so running the job more than
once a day never double-sends.

**Time-budgeted:** the run stops starting new sends after ~25s (override with
`REMINDER_TIME_BUDGET_MS`) so it returns a report rather than being killed
mid-flight. Anything deferred is picked up by the next run.

### What gets skipped

A due location is skipped (counted in `skipped`, not emailed) when its campaign
is missing its sales person, client, or owning user — i.e. a relation was
deleted.

### Failure reporting

Send failures are always collected per user group and logged with
`console.error`. If `REMINDER_ERROR_REPORT_TO` is set, they are **also** emailed
as a single digest — with timestamps, campaign ids and error messages — to that
address, from the failing user's own mailbox. With the variable unset, failures
are log-only.

If the failure was opening the mailbox itself there is nowhere to send from, so
that case only ever reaches the log.

The route still returns HTTP 200 with the run counters, so an hourly schedule
doesn't raise an alert for a single bad address.

### Editing behaviour

The reminder series is anchored to the end date. Editing a location leaves its
place in the series alone unless the **end date** moves, in which case the
schedule is recomputed from scratch.

### Manual send

**Send reminder** on a campaign (or a single location) emails the sales person
immediately and advances the schedule past today, so the automated series
doesn't fire again for those locations the same day.

## Email templates

Templates live in [`src/lib/mail/`](../src/lib/mail), one file per type, sharing
`shared.ts` for the card/layout markup:

| File | Purpose |
| --- | --- |
| `expiry-reminder.ts` | Campaign expiring soon |
| `creative-reminder.ts` | Creative still pending |
| `error-update.ts` | Failure digest for the maintainer |

`src/lib/mailer.ts` only builds transports and delivers a rendered message.

## Dates and timezone

Start, end and reminder dates are **calendar dates**, stored as UTC midnight.
All date arithmetic uses UTC (`startOfDay`, `addDays`, `daysUntil` in
[`src/lib/campaign.ts`](../src/lib/campaign.ts)), so results are identical on a
UTC server and an IST laptop.

The only place a timezone applies is `businessToday()`, which answers "what
calendar day is it now" in IST (+5:30). The job uses it for its day boundaries,
so an hourly schedule is correct at every hour — including between 00:00 and
05:30 IST.

> **Do not set `TZ` on the deployment.** These helpers are timezone-independent
> by construction; setting `TZ` would make new writes land at `18:30Z` of the
> previous day and mix two representations of the same calendar day.

## Gmail setup

Nodemailer sends through Gmail using an **App Password** (not the account
password):

1. The sender Google account must have **2-Step Verification** enabled.
2. Create an app password: <https://support.google.com/accounts/answer/185833>
3. Use the 16-character value as the user's `appPassword` when creating them via
   [`POST /api/users`](./api.md#post-apiusers).

The app password is **encrypted at rest** (AES-256-GCM using `ENCRYPTION_KEY`)
and decrypted only in-memory at send time — it is never stored or logged in
plaintext.

> Error `535-5.7.8 Username and Password not accepted` means the app password is
> wrong, revoked, or a placeholder. Re-create the user with a valid one.

Gmail caps sending at roughly **500 messages/day** (consumer) or **2000/day**
(Workspace) per account. Since each backend user sends from their own mailbox,
that limit — not the job — is the practical ceiling.

## Scheduling

The job is just an HTTP call. Run it **hourly**: the per-day dedupe makes
re-runs safe, and it gives 24 automatic retries for anything deferred or failed.

```
POST https://your-app.com/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

Schedulers that can't set headers may pass `?secret=<CRON_SECRET>` instead —
prefer the header, since query strings show up in logs.

- **cron-job.org / GitHub Actions / system cron** — schedule `0 * * * *`.
- **Vercel Cron** — needs a `vercel.json` and only permits daily schedules on
  the Hobby plan, so an external scheduler is preferred for hourly runs.

### Running it by hand

`scripts/run-reminders.ts` drives the same code without the dev server:

```bash
npm run reminders -- --dry               # list what's due, send nothing
npm run reminders -- --dry 2026-07-20    # ...as if it were that day
npm run reminders -- 2026-07-20          # actually send, as if it were then
npm run reminders                        # actually send, now
```

Passing a date is how you test a milestone without waiting for it. `--dry` runs
only the planner query, so it never sends.

## Environment

| Variable | Purpose |
| --- | --- |
| `CRON_SECRET` | Secret required to trigger the job |
| `REMINDER_ERROR_REPORT_TO` | Where failure digests go. Unset = failures are logged only |
| `REMINDER_USER_CONCURRENCY` | How many users send in parallel (default 4) |
| `REMINDER_TIME_BUDGET_MS` | When to stop starting new sends (default 25000) |
