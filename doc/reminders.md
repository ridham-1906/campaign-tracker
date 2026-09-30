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

## Vendor reminders

Vendors are emailed on **calendar dates picked per vendor** (Vendors screen →
Edit → *Reminder dates*), to any number of optional *Reminder emails*. A vendor
with no email or no dates is never emailed.

On each chosen date the vendor gets **one email per campaign** it has live sites
on, sent from the campaign owner's Gmail. It lists only that vendor's own sites —
never another vendor's — with end date and days left. **Only LIVE sites** are
included: ended and pending-creative sites are left out, and a vendor with no
live sites on a campaign gets no email for it.

- Dedupe is a `VendorReminder` row per (vendor, campaign, day), claimed *before*
  sending so overlapping runs can't double-send. A failed send releases the
  claim, so the next hourly run retries.
- A date that passes without a successful send is **not** caught up later.
- Vendor reminders run inside `/api/cron/reminders` after the expiry pass,
  within what's left of the same time budget; the response carries a `vendor`
  object with its own counters.
- Implementation: [`src/lib/reminders/vendor.ts`](../src/lib/reminders/vendor.ts),
  template [`src/lib/mail/vendor-reminder.ts`](../src/lib/mail/vendor-reminder.ts).

## Vendor mid-monitoring reminders

Separate from the vendor reminders above, and not tied to a vendor's chosen
dates: once a location's **mid date** arrives, its vendor (if it has an email)
is asked for the mid-campaign monitoring photo — one email per campaign,
listing just the sites of that vendor's that reached their mid date.

- Only **LIVE** locations are considered — ended sites, and ones whose end date
  has passed, are dropped, same as the vendor reminders above.
- It **repeats every day** the mid date has passed, tracked by
  `midReminderSentAt`, until a "Mid date" photo is uploaded against that
  location's current term (checked via the `Attachment` collection) — then it
  stops for good, even if the mid date already came and went.
- Renewing a campaign starts a fresh term, so a location keeps a past term's
  mid photo on file but is asked again once its new mid date arrives.
- Runs alongside the vendor reminders above, inside `/api/cron/reminders`; the
  response carries a `vendorMid` object with its own counters.
- Implementation: `findMidMonitoringJobs` / `runVendorMidReminders` in
  [`src/lib/reminders/vendor.ts`](../src/lib/reminders/vendor.ts), template
  [`src/lib/mail/vendor-mid-reminder.ts`](../src/lib/mail/vendor-mid-reminder.ts).
- Not sent by the manual "Send reminder" button — that only sends the
  sites-are-due vendor email, not the mid-monitoring ask.

## The job

Two endpoints share one implementation, so they can sit on different schedules:

| Route | Sends | Cadence |
| --- | --- | --- |
| `/api/cron/reminders` | Expiry only | Several times a day — repeats are retries |
| `/api/cron/creative-reminders` | Pending creative only | Once a day |

Both authenticate with `CRON_SECRET` through the same `cronGuard` helper in
[`src/lib/api.ts`](../src/lib/api.ts). Each does the whole pass:

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

It then emails each vendor (with an address) on those locations about its own
live sites (pending-creative and ended ones are skipped), and records the send so the automated vendor reminder skips that
vendor/campaign today. A vendor failure is reported back as a warning toast; it
doesn't undo the sales email.

## Email templates

Templates live in [`src/lib/mail/`](../src/lib/mail), one file per type, sharing
`shared.ts` for the card/layout markup:

| File | Purpose |
| --- | --- |
| `expiry-reminder.ts` | Campaign expiring soon |
| `creative-reminder.ts` | Creative still pending |
| `vendor-reminder.ts` | Vendor site status on a chosen date |
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

`appPassword` is optional. A user without one (missing or empty) sends no mail
at all: every run counts their campaigns as `skipped`, logs one warning naming
the account, and never opens a transport — nothing lands in `errors`. Clear a
user's app password directly in MongoDB to turn their reminders off.

The app password is **encrypted at rest** (AES-256-GCM using `ENCRYPTION_KEY`)
and decrypted only in-memory at send time — it is never stored or logged in
plaintext.

> Error `535-5.7.8 Username and Password not accepted` means the app password is
> wrong, revoked, or a placeholder. Re-create the user with a valid one.

Gmail caps sending at roughly **500 messages/day** (consumer) or **2000/day**
(Workspace) per account. Since each backend user sends from their own mailbox,
that limit — not the job — is the practical ceiling.

## Scheduling

Both jobs are plain HTTP calls with the secret in the header. Schedulers that
can't set headers may pass `?secret=<CRON_SECRET>` instead — prefer the header,
since query strings show up in logs.

```
POST https://your-app.com/api/cron/reminders             0 11-19 * * *
POST https://your-app.com/api/cron/creative-reminders    0 11 * * *
Authorization: Bearer <CRON_SECRET>
```

Set the scheduler's timezone to **Asia/Kolkata** so its clock matches
`businessToday()`.

Expiry runs on the hour through the working day: the first run that finds a
milestone sends it, and the remaining runs are free retries for anything that
failed or was deferred. Creative runs once, since it is a daily nudge and the
per-day dedupe would ignore the extra calls anyway.

**Vercel Cron** needs a `vercel.json` and only permits daily schedules on the
Hobby plan, so an external scheduler is preferred for the hourly one.

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
