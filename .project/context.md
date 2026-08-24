# Campaign Tracker — context

Internal tool for an outdoor-advertising agency. A backend user records
campaigns (client, sales person, and the physical sites the campaign runs at),
and a cron job emails the assigned sales person as sites approach their end date
or sit waiting on creative.

## Stack

Next.js 16 (App Router) · TypeScript · MongoDB via Mongoose · Tailwind v4 +
shadcn/ui (base-ui primitives) · TanStack Query (server state) + TanStack Table
(manual mode) · JWT cookie auth (`jose`) · Nodemailer over Gmail app passwords ·
Appwrite for file storage.

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
 ├─ Campaign  → clientId, salesId
 │    └─ locations[]  (embedded subdocuments — the unit of work)
 │         city, location, type, vendorId
 │         startDate, endDate, days, status
 │         reminderDate, reminderSent, reminderSentAt, creativeReminderSentAt
 └─ Attachment  → campaignId, locationId
      kind, stage, fileId, filename, mimeType, size, uploadedAt
```

**Locations, not campaigns, are the unit of everything.** Each has its own
dates, its own lifecycle status (`LIVE` / `PENDING_CREATIVE` / `ENDED`) and its
own reminder schedule. A campaign is a grouping; one email covers all of a
campaign's due locations.

**Attachments are their own collection, not embedded in the location.**
Embedding meant the images screen had to `$unwind` every campaign to page over
files, the campaign list carried metadata it never renders (~half its payload),
and each single-file upload rewrote the whole campaign document. `locationId`
is safe as a foreign key because `updateCampaignForUser` reconciles the
locations array in place, so a location's `_id` survives edits.

⚠️ **Two cascades are no longer free** — deleting a campaign, *and editing a
campaign to drop a location*. Both go through `deleteAttachmentsFor()` in
`src/lib/services.ts`, which removes the rows and their Appwrite blobs. If
either regresses nothing throws: the rows just become unreachable and the blobs
keep costing storage. `npm run check:attachments` sweeps for exactly that.

## File transfer — bytes bypass the app

Vercel caps a function's request **and** response body at ~4.5MB, below our own
limits (25MB images, 100MB documents), so files move browser ⇄ Appwrite
directly and only metadata goes through the API.

- **Upload** is two calls: `POST .../attachments/upload-ticket` checks ownership
  and the image type, mints a create-only Appwrite JWT, and signs the file ids
  it generated into a ticket; the browser uploads with the `appwrite` web SDK
  (chunked, with real progress); `POST .../attachments` then registers each file
  from `{ticket, fileId}`, reading filename/mime/size back from Appwrite rather
  than trusting the client.
- **Download** — both `GET .../attachments/:id` and the public
  `GET /api/share/:token/files/:id` keep their access check and then redirect to
  a short-lived Appwrite file token (1h and 10min respectively). `?download=1`
  switches Appwrite from an inline to an attachment disposition — needed because
  `<a download>` is ignored once the href redirects cross-origin.
- **Zips and PPT exports are built in the browser** (JSZip, 4-way concurrent
  fetch). No route returns a bundle, so their size is bounded by browser memory
  rather than by any serverless limit.

Two things this depends on, neither visible in the code:

- The Appwrite project must list the app's origins as **web platforms**, or the
  gallery, ZIP download and PPT export fail on CORS. The bucket grants `create`
  to `APPWRITE_UPLOAD_USER_ID` and nothing else.
- Deleting a share no longer cuts access instantly — an already-issued preview
  URL keeps working for up to 10 minutes.

⚠️ A blob now exists **before** its Mongo row, so an abandoned upload leaves an
orphaned file. `check-attachments` sweeps rows-without-files, not
files-without-rows.

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

Two kinds, both driven by `runDueReminders` in `src/lib/reminders.ts`, which
takes a `kinds` option so each gets its own schedule. Both routes authenticate
with `CRON_SECRET` via `cronGuard` in `src/lib/api.ts`:

- `GET|POST /api/cron/reminders` — expiry only, run hourly (`0 11-19 * * *`)
- `GET|POST /api/cron/creative-reminders` — creative only, daily (`0 11 * * *`)

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
| `src/app/(app)/` | Authenticated pages (campaigns, clients, sales, vendors, images) — thin server shells that only `requireSession()` |
| `src/app/(auth)/` | Login page + server actions |
| `src/app/api/` | JSON REST API, admin user creation, cron entry point |
| `src/app/providers.tsx` | The app's single client boundary — `QueryClientProvider` |
| `src/lib/` | Server logic: `services.ts` (campaign writes), `data.ts` (read views + aggregations), `reminders.ts`, `campaign.ts` (pure date/lifecycle helpers), `mailer.ts` (transport) |
| `src/lib/queries/` | TanStack Query hooks, one file per resource — a key, its fetcher and its invalidators stay together |
| `src/lib/query-keys.ts` | Hierarchical keys, so `invalidateQueries` can clear a resource by prefix |
| `src/lib/query-client.ts` | Client defaults + the central 401 handler and retry policy |
| `src/lib/view-types.ts` | The wire shapes, **client-safe** — imported by both `data.ts` and components so they can't drift |
| `src/lib/mail/` | One file per email template + shared markup helpers |
| `src/models/` | Mongoose schemas |
| `src/components/` | Client components; `ui/` is shadcn |
| `src/proxy.ts` | Next 16 middleware — session gate |

`src/lib/campaign.ts` has no `server-only` guard on purpose: client components
import the same date/lifecycle helpers so UI and cron never disagree.

## Reads, pagination and caching

**Every list is paginated in the database.** Pages are server shells; the data
is fetched client-side so the table's page, search, sort and status filter can
drive the query. `GET /api/campaigns|clients|vendors|sales|images` return
`{ rows, total, page, limit }` — they used to return bare arrays of everything.
`parseListParams` in `src/lib/api.ts` parses `page`/`limit`/`q`/`sort`/`dir`,
falling back rather than 400-ing, with `sort` checked against a per-endpoint
allow-list (it is interpolated straight into `$sort`).

For the *complete* list a combobox needs, use the `/options` routes — a
separate endpoint rather than `?all=1`, so no caller has to narrow
`T[] | Page<T>` and there is no way to pull an unbounded list through the
paginated path.

Traps that already bit once, or nearly did:

- **`Model.aggregate()` does not cast `userId`.** `find()`/`countDocuments()`
  do, which is why passing a string always worked — but pipelines go to the
  driver verbatim and a string never matches an ObjectId. Empty list, no error.
  Every `$match` in `data.ts` goes through the `oid()` helper.
- **"Today" is computed in Node** (`businessToday()`) and injected as a literal.
  Never `$$NOW`/`$dateTrunc` — they are UTC and would misclassify for 5.5h a day.
- **`statusFilters()` in `data.ts` mirrors `lifecycleState()` in `campaign.ts`**
  as `$elemMatch` fragments. The two must stay in step.
- `$sort` always carries an `_id` tiebreaker; without it, tied sort keys reorder
  between requests and skip-pagination duplicates or drops rows across pages.
- Entity `count` columns are computed for the current page's ids only, which is
  why `count` is not a sort key.

Mutations are `useMutation` + `invalidateQueries`. This replaced
`router.refresh()`, which re-rendered the whole route — and so re-queried every
campaign — after each write. Login/logout remain server actions.

`apiJson()` in `src/lib/http.ts` **throws** an `ApiError` on non-2xx; a query
only counts as failed if its function rejects, and the status it carries is what
lets `query-client.ts` redirect once on a 401 (the proxy excludes `/api`, so an
expired session in an open tab surfaces only as JSON) and skip retries on 4xx.

## Conventions

- Campaign writes go through `src/lib/services.ts` so the location/reminder
  rules live in one place, shared by the UI and the JSON API.
- `PATCH /api/campaigns/:id` takes the **whole** locations array: entries with
  an `id` are updates, without are inserts, omitted ones are deleted.
- Excel import (`src/lib/campaign-excel.ts`) fills the campaign form client-side;
  it never writes directly.
- Object URLs for image previews are created and revoked **in event handlers**,
  never `useMemo` + effect cleanup. StrictMode runs mount → cleanup → mount, so
  the cleanup revoked URLs the memo then handed back dead — every thumbnail
  rendered blank.

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

npm run check:attachments               # sweep for orphaned attachments
npm run check:attachments -- --delete   # ...and remove them + their blobs
```

`check-attachments.ts` is the guard for the cascade risk above; a clean run
means every attachment row still resolves to a live campaign and location. It
does **not** yet sweep the opposite direction — see "File transfer" below.

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
`ENCRYPTION_KEY` · `APPWRITE_*` (including `APPWRITE_UPLOAD_USER_ID`, the
create-only identity browsers upload as) · optional `REMINDER_USER_CONCURRENCY`,
`REMINDER_TIME_BUDGET_MS`, `REMINDER_ERROR_REPORT_TO`.

## Known issues

- `README.md` is **stale**: it describes a standalone `Reminder` model and
  campaign-level `city`/`type`/`status` (`ACTIVE`/`PAUSED`/`COMPLETED`) that no
  longer exist. `doc/architecture.md` and `doc/rest-api.md` have been brought
  back in line.
- An attachment whose location was deleted still counts toward a campaign row's
  `fileCount` on the images screen, but the preview dialog can't show it —
  `getCampaign()` only reads locations that still exist. `npm run
  check:attachments` exists to keep that at zero.
- The local dev database holds rows written by an IST process, so their dates
  sit at `18:30Z` (a day early) rather than `00:00Z`. Reseed rather than
  migrate. Production is written only by Vercel (UTC) and is unaffected.
- The images aggregation groups all of a user's attachments before applying a
  search term. Fine at current volume — the `{userId, campaignId, uploadedAt}`
  index keeps the group covered; if it ever shows up, denormalise `clientId`
  onto the attachment row at insert time.
