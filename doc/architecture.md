# Architecture

## Stack

| Layer | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router, React Server Components, Server Actions) |
| Language | **TypeScript** |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (base-ui primitives) |
| Database | **MongoDB** via **Mongoose** |
| Auth | bcrypt password hashing + **JWT session cookie** (`jose`) |
| Email | **Nodemailer** (Gmail app password, per user) |
| Scheduling | Secured API route + external/Vercel cron |

## Data model

All records except `User` are **scoped to the owning `User`** (`userId`), so each
backend person only sees their own data.

```
User (login / backend person)
 ├─ Sales   (name, email)        ← reminder recipients
 ├─ Vendor  (name)
 ├─ Client  (name)
 └─ Campaign (city, type, location, days, status, startDate, endDate)
      ├─ → Sales, Vendor, Client
      └─ Reminder (date, sent, sentAt)
```

| Model | Key fields |
| --- | --- |
| `User` | name, email (unique), password (bcrypt hash), appPassword (Gmail, **AES-256-GCM encrypted**) |
| `Sales` | name, email, userId |
| `Vendor` | name, userId |
| `Client` | name, userId |
| `Campaign` | city, type, location, days, status (`ACTIVE`/`PAUSED`/`COMPLETED`), startDate, endDate, userId, salesId, vendorId, clientId |
| `Reminder` | campaignId, date, sent, sentAt |

Models are defined in [`src/models/index.ts`](../src/models/index.ts).

### Derived status

The stored `status` is `ACTIVE` / `PAUSED` / `COMPLETED`. The **badge** shown in
the UI is derived from status + dates (`Upcoming`, `Active`, `Expiring soon`,
`Expired`, `Paused`, `Completed`) in [`src/lib/campaign.ts`](../src/lib/campaign.ts).

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

```
Browser → proxy.ts (verify cookie)
        → (app)/page.tsx  (RSC)
        → requireSession()  → getCampaigns(userId)  [src/lib/data.ts]
        → connectDB() + Mongoose query (populate sales/vendor/client + reminders)
        → returns plain objects → rendered table with StatusBadge
```

Writes go through **Server Actions** (`actions.ts` files), which validate input
with **zod**, mutate via Mongoose, then `revalidatePath()` to refresh the UI.
