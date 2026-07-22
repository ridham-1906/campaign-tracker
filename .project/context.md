# Campaign Tracker — context

Internal tool for an outdoor-advertising agency. A backend user records
campaigns (client, sales person, and the physical sites the campaign runs at),
and a cron job emails the assigned sales person as sites approach their end date
or sit waiting on creative.

## Stack

Next.js 16 (App Router) · TypeScript · MongoDB via Mongoose · Tailwind v4 +
shadcn/ui (base-ui primitives) · JWT cookie auth (`jose`) · Nodemailer over
Gmail app passwords · Appwrite for file storage.

> `AGENTS.md`: this Next.js version has breaking changes — read
> `node_modules/next/dist/docs/` before writing framework-level code.

## Data model

Everything except `User` is scoped by `userId`, so each backend person only sees
their own records.

```
User (login)  name, email, password (bcrypt), appPassword (AES-256-GCM)
 ├─ Sales     name, email          ← reminder recipients
 ├─ Vendor    name
 ├─ Client    name
 └─ Campaign  → clientId, salesId
      └─ locations[]  (embedded subdocuments — the unit of work)
           city, location, type, vendorId
           startDate, endDate, days, status
           reminderDate, reminderSent, reminderSentAt, creativeReminderSentAt
           attachments[]  (embedded; bytes live in Appwrite)
```

**Locations, not campaigns, are the unit of everything.** Each has its own
dates, its own lifecycle status (`LIVE` / `PENDING_CREATIVE` / `ENDED`) and its
own reminder schedule. A campaign is a grouping; one email covers all of a
campaign's due locations.

Models live one-per-file in `src/models/`, re-exported from `src/models/index.ts`.

## Dates — important

Start/end/reminder dates are **calendar dates stored as UTC midnight**. Every
helper in `src/lib/campaign.ts` (`startOfDay`, `addDays`, `daysUntil`) uses UTC
methods so behaviour is identical on a UTC server and an IST laptop.

`businessToday()` is the only timezone-aware function — it answers "what
calendar day is it now" in IST (+5:30) and is what the cron uses for its day
boundaries.

**Never set `TZ` on the deployment.** It would make new writes land at `18:30Z`
of the previous day and mix two representations of the same calendar day.

## Reminders

Two kinds, both driven by `runDueReminders` in `src/lib/reminders.ts` and
triggered hourly via `GET|POST /api/cron/reminders` (bearer `CRON_SECRET`):

- **Expiry** — at 7, 5, 3, 2 and 1 days before a location's end date.
  `reminderDate` holds the *next* one and rolls forward after each send.
- **Creative** — every day a location sits in `PENDING_CREATIVE`, until the
  status changes.

Dedupe is by `reminderSentAt` / `creativeReminderSentAt` being older than today,
so re-running the job never double-sends and a missed day is caught up.

Data flow per run: one aggregation filters and projects server-side and joins
sales/client/owner → jobs grouped by owning user → sent over that user's pooled
Gmail transport → recorded per campaign with a targeted `bulkWrite`. Failures
are always logged, and emailed as a digest when `REMINDER_ERROR_REPORT_TO` is
set.

Full detail: `doc/reminders.md`.

## Layout

| Path | What |
| --- | --- |
| `src/app/(app)/` | Authenticated pages (campaigns, clients, sales, vendors, images) |
| `src/app/(auth)/` | Login page + server actions |
| `src/app/api/` | JSON REST API, admin user creation, cron entry point |
| `src/lib/` | Server logic: `services.ts` (campaign writes), `data.ts` (read views), `reminders.ts`, `campaign.ts` (pure date/lifecycle helpers), `mailer.ts` (transport) |
| `src/lib/mail/` | One file per email template + shared markup helpers |
| `src/models/` | Mongoose schemas |
| `src/components/` | Client components; `ui/` is shadcn |
| `src/proxy.ts` | Next 16 middleware — session gate |

`src/lib/campaign.ts` has no `server-only` guard on purpose: client components
import the same date/lifecycle helpers so UI and cron never disagree.

## Conventions

- Campaign writes go through `src/lib/services.ts` so the location/reminder
  rules live in one place, shared by the UI and the JSON API.
- `PATCH /api/campaigns/:id` takes the **whole** locations array: entries with
  an `id` are updates, without are inserts, omitted ones are deleted.
- Excel import (`src/lib/campaign-excel.ts`) fills the campaign form client-side;
  it never writes directly.

## Commands

```bash
npm run dev
npm run build
npx tsc --noEmit
npx eslint <paths>

npm run reminders                       # list what's due, send nothing
npm run reminders -- 2026-07-20         # ...as if it were that day
npm run reminders -- --send             # actually send

npm run clone-prod                      # preview a prod -> local data copy
npm run clone-prod -- --yes             # do it (target must be localhost)
npm run clone-prod -- --into=name --yes # ...into a different local db

npm run migrate -- --target=local       # preview reminder-field migration
npm run migrate -- --target=prod --yes  # apply it
```

`migrate-reminders.ts` normalises `reminderDate` / `reminderSent` to the series
model and backfills `creativeReminderSentAt`. Idempotent, and it calls
`syncIndexes()`. The app reads un-migrated documents correctly, so it is a
tidy-up rather than a prerequisite.

**`scripts/*` is gitignored**, so these files are local-only even though
`package.json` references them — a fresh clone won't have them. They run outside
Next, hence `--conditions=react-server` (to satisfy `server-only`) and
`--env-file=.env`.

`MAIL_DISABLED=1` suppresses every outbound email (all sends funnel through
`sendMailWith`). Set it whenever the local database holds a copy of production.

## Environment

`MONGODB_URI` · `JWT_SECRET` · `CRON_SECRET` · `REGISTER_SECRET` ·
`ENCRYPTION_KEY` · `APPWRITE_*` · optional `REMINDER_USER_CONCURRENCY`,
`REMINDER_TIME_BUDGET_MS`, `REMINDER_ERROR_REPORT_TO`.

## Known issues

- `doc/architecture.md` and `README.md` are **stale**: they describe a
  standalone `Reminder` model and campaign-level `city`/`type`/`status`
  (`ACTIVE`/`PAUSED`/`COMPLETED`) that no longer exist.
- The local dev database holds rows written by an IST process, so their dates
  sit at `18:30Z` (a day early) rather than `00:00Z`. Reseed rather than
  migrate. Production is written only by Vercel (UTC) and is unaffected.
