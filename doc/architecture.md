# Architecture

## Stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router, React Server Components, Server Actions) |
| Language | **TypeScript** |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (base-ui primitives) |
| Database | **MongoDB** via **Mongoose** |
| Server state | **TanStack Query** (all list reads + every mutation) |
| Tables | **TanStack Table** in manual mode — the database pages, sorts and filters |
| Auth | bcrypt password hashing + **JWT session cookie** (`jose`) |
| File storage | **Appwrite Storage** (binaries only; metadata lives in Mongo) |
| Email | **Nodemailer** (Gmail app password, per user) |
| Scheduling | Secured API route + external/Vercel cron |

## Data model

All records except `User` are **scoped to the owning `User`** (`userId`), so each
backend person only sees their own data.

**Locations, not campaigns, are the unit of everything.** A campaign is a client
plus a sales person plus one or more locations; dates, status and reminders all
live on the location.

```
User (login / backend person)
 ├─ Sales   (name, email)        ← reminder recipients
 ├─ Vendor  (name)
 ├─ Client  (name)
 ├─ Campaign (clientId, salesId)
 │    └─ locations[]  (embedded: city, location, type, vendorId,
 │                     startDate, endDate, days, status, reminder fields)
 └─ Attachment (campaignId, locationId, kind, stage, fileId, …)
```

| Model | Key fields |
| --- | --- |
| `User` | name, email (unique), password (bcrypt hash), appPassword (Gmail, **AES-256-GCM encrypted**) |
| `Sales` | name, email, userId |
| `Vendor` | name, userId |
| `Client` | name, userId |
| `Campaign` | userId, clientId, salesId, locations[] |
| *(embedded)* location | city, location, type, vendorId, startDate, endDate, days, status (`LIVE`/`ENDED`/`PENDING_CREATIVE`), reminderDate, reminderSent, reminderSentAt, creativeReminderSentAt |
| `Attachment` | userId, campaignId, locationId, kind, stage, fileId, filename, mimeType, size, uploadedAt |

Models are defined under [`src/models/`](../src/models/) and barrelled through
[`src/models/index.ts`](../src/models/index.ts).

### Attachments are their own collection

Deliberately not embedded in the location subdocument. Embedding meant the
images screen had to unwind every campaign to page over files, the campaign list
carried metadata it never renders, and each single-file upload rewrote the whole
campaign document.

The images screen shows one row per campaign, but that is a *read* shape,
assembled by the aggregation in `getCampaignImagesPage()` — it isn't a reason to
fold the files back into the campaign document. Grouping costs a `$group`;
embedding would cost a whole-document rewrite on every upload.

The cost is that two cascades are no longer free — deleting a campaign, **and
editing a campaign to drop a location** — so both funnel through
`deleteAttachmentsFor()` in [`src/lib/services.ts`](../src/lib/services.ts),
which removes the rows and their Appwrite blobs. If either regresses the failure
is silent: the rows just become unreachable and the blobs keep costing storage.
`npm run check:attachments` sweeps for exactly that.

### Derived status

A location's stored `status` is `LIVE` / `ENDED` / `PENDING_CREATIVE`. The state
actually shown is derived from that plus the end date — a `LIVE` location whose
end date has passed reads as ended, while `PENDING_CREATIVE` never flips on its
own. `lifecycleState()` in [`src/lib/campaign.ts`](../src/lib/campaign.ts) is the
one definition; `statusFilters()` in [`src/lib/data.ts`](../src/lib/data.ts)
mirrors it as Mongo `$elemMatch` fragments for the paginated list and the stat
tiles. **Those two must stay in step.**

Dates are stored at UTC midnight and "today" means the current calendar day in
IST (`businessToday()`), computed in Node and passed into queries as a literal —
never `$$NOW`, which is UTC and would misclassify campaigns for 5.5 hours a day.

## Auth flow

1. `POST /api/users` (admin, secret-protected) creates a user with a bcrypt-
   hashed password.
2. On login, the server action verifies the password and issues a **signed JWT**
   stored in an **httpOnly cookie** `campaign_session` (7-day expiry).
3. [`src/proxy.ts`](../src/proxy.ts) (Next 16's middleware) runs on every request:
   verifies the cookie and redirects unauthenticated users to `/login`; sends
   logged-in users away from `/login`. `/api/*` is excluded (those routes use
   their own secrets).
4. Server components/actions call `requireSession()` to enforce and read the
   current user.

Edge-safe JWT helpers live in [`src/lib/session.ts`](../src/lib/session.ts) (used
by the proxy); node-only bits (bcrypt, cookies) live in
[`src/lib/auth.ts`](../src/lib/auth.ts).

### Sensitive data at rest

| Field | Protection |
| --- | --- |
| Login password | bcrypt hash (one-way) |
| Gmail app password | **AES-256-GCM encryption** ([`src/lib/crypto.ts`](../src/lib/crypto.ts)) with `ENCRYPTION_KEY`; decrypted only in-memory when sending an email |

Encrypted values are tagged `v1.` so legacy plaintext rows pass through
untouched (re-save to encrypt them).

## Project layout

```
src/
  app/
    (auth)/
      login/page.tsx        # login screen (only public page)
      auth-form.tsx         # login form (client)
      actions.ts            # loginAction / logoutAction (server actions)
    (app)/
      layout.tsx            # nav + requireSession() guard
      page.tsx              # dashboard (campaign list + stats)
      campaigns/
        new/page.tsx        # create
        [id]/page.tsx       # detail (+ send reminder now, delete)
        [id]/edit/page.tsx  # edit
        campaign-form.tsx   # shared form (client)
        actions.ts          # create/update/delete/sendReminderNow
      people/
        page.tsx            # manage sales / vendors / clients
        person-forms.tsx    # add forms (client)
        actions.ts          # add/delete people
    api/
      users/route.ts        # POST — admin user creation (REGISTER_SECRET)
      cron/reminders/route.ts  # GET/POST — daily reminder job (CRON_SECRET)
  lib/
    db.ts                   # cached Mongoose connection
    session.ts              # edge-safe JWT sign/verify
    auth.ts                 # bcrypt, cookie session, requireSession
    crypto.ts               # AES-256-GCM encrypt/decrypt for app passwords
    mailer.ts               # nodemailer + reminder email template
    campaign.ts             # date/status helpers (pure)
    data.ts                 # server-side read queries → plain view objects
    reminders.ts            # runDueReminders() job logic
  models/index.ts           # Mongoose schemas/models
  components/
    ui/                     # shadcn components
    status-badge.tsx
  proxy.ts                  # auth middleware
scripts/
  seed.ts                   # demo data (npm run seed)
  run-reminders.ts          # trigger the job locally (npm run reminders)
vercel.json                 # daily cron definition
```

## Request lifecycle (reading campaigns)

Pages are thin server shells; the data itself is fetched client-side so the
table's page, search, sort and status filter can drive the query.

```
Browser → proxy.ts (verify cookie)
        → (app)/page.tsx  (RSC) → requireSession() → <CampaignManager />
        → useCampaignsQuery({page, limit, q, status, sort, dir})   [TanStack Query]
        → GET /api/campaigns?…  → authGuard() + parseListParams()
        → getCampaignsPage(userId, params)  [src/lib/data.ts]
        → Mongo aggregation: $match → $addFields(earliestEnd) → $sort → $skip/$limit
          → $lookup client/sales (on one page's rows, never before paginating)
        → { rows, total, page, limit } → rendered table with StatusBadge
```

The stat tiles are a second query (`GET /api/campaigns/stats`) because totals
across the whole result set can't be derived from one page.

Writes go through the REST routes via `useMutation`, which validate input with
**zod**, mutate via Mongoose, and then `invalidateQueries()` the affected keys.
This replaced `router.refresh()`, which re-rendered the entire route — and
therefore re-queried every campaign — after each mutation. Login/logout are the
exception and remain Server Actions.

### Query conventions

- Keys live in [`src/lib/query-keys.ts`](../src/lib/query-keys.ts) and are
  hierarchical, so `invalidateQueries` can clear a resource by prefix — a
  rename must invalidate both the entity list and `campaigns`, since campaign
  rows render the name.
- Hooks live in [`src/lib/queries/`](../src/lib/queries/), one file per
  resource, keeping a key, its fetcher and its invalidators together.
- `apiJson()` in [`src/lib/http.ts`](../src/lib/http.ts) **throws** an
  `ApiError` on a non-2xx; a query only counts as failed if its function
  rejects. `ApiError` carries the status, which is what lets
  [`src/lib/query-client.ts`](../src/lib/query-client.ts) redirect once on a
  401 and skip retries on 4xx.
- List queries use `placeholderData: keepPreviousData` so paging never flashes
  an empty table.
