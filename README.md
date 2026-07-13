# Campaign Tracker

Internal tool for the backend sales team to **track campaign status** and
**automatically remind sales people when a campaign is about to expire**.

Each backend person logs in, manages their sales people / vendors / clients,
creates campaigns, and a daily cron job emails the assigned sales person before
a campaign ends.

## Documentation

Full docs live in [`doc/`](./doc):

- [Getting Started](./doc/getting-started.md) — setup, env vars, install, run
- [User Guide](./doc/user-guide.md) — how to use the app
- [REST API](./doc/rest-api.md) — full JSON CRUD for campaigns, sales, vendors, clients, reminders
- [Admin API](./doc/api.md) — create users, trigger reminders
- [Reminders](./doc/reminders.md) — how the cron/email system works
- [Architecture](./doc/architecture.md) — stack, data model, layout

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui**
- **MongoDB** + **Mongoose**
- **Auth**: bcrypt password hashing + JWT session cookie (`jose`), enforced in middleware
- **Email**: **Nodemailer** (Gmail app password, per user)
- **Cron**: a secured API route, schedulable via Vercel Cron or any scheduler

## Data model

| Model | Fields |
| --- | --- |
| `User` (backend person / login) | name, email, password (hash), appPassword (Gmail) |
| `Sales` | name, email, userId |
| `Vendor` | name, userId |
| `Client` | name, userId |
| `Campaign` | client, sales, vendor, city, type, location, days, status, startDate, endDate, userId |
| `Reminder` | campaign, date, sent, sentAt |

All records are scoped to the owning `User`, so each backend person only sees
their own campaigns and people.

## Getting started

### 1. Prerequisites

- Node 20+
- A MongoDB instance (local `mongod`, Docker, or MongoDB Atlas)

### 2. Configure environment

Copy the example and fill it in:

```bash
cp .env.example .env
```

| Var | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string used to sign session cookies |
| `CRON_SECRET` | Secret required to trigger the reminder job |
| `REGISTER_SECRET` | Secret required to create users via `POST /api/users` |
| `APP_URL` | Base URL used in reminder emails |

### 3. Install & seed

```bash
npm install
npm run seed      # creates a demo user + sample campaigns
```

Demo login: **demo@company.com** / **password123**

> Update the seeded user's Gmail **app password** before real reminder emails
> can send.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to `/login`.

## Adding users (admin only)

There is **no public signup**. Users are provisioned only through a secret-
protected API, so you create the 2-3 backend accounts yourself (e.g. from
Postman). The endpoint is guarded by `REGISTER_SECRET`.

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $REGISTER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Ravi Kumar",
        "email": "ravi@company.com",
        "password": "a-strong-password",
        "appPassword": "gmail-16-char-app-password"
      }'
```

| Response | Meaning |
| --- | --- |
| `201` | User created (`{ id, name, email }`) |
| `401` | Missing/incorrect `REGISTER_SECRET` |
| `409` | Email already exists |
| `400` | Invalid body |

`appPassword` is the sender Gmail account's [app password](https://support.google.com/accounts/answer/185833)
used by nodemailer for that user's reminder emails.

## The reminder job

Every campaign gets a `Reminder` dated **7 days before its end date** by default
(editable per campaign on the form). Once a day the job finds reminders dated
*today* that haven't been sent and emails the campaign's sales person from the
backend user's Gmail. Reminders are marked `sent`, so re-runs never double-send.

### Trigger it

- **Locally** (dev server running):
  ```bash
  npm run reminders
  ```
- **Directly**:
  ```bash
  curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
    http://localhost:3000/api/cron/reminders
  ```
- **Vercel Cron**: [`vercel.json`](./vercel.json) runs it daily at 04:00 UTC and
  sends `Authorization: Bearer $CRON_SECRET` automatically.
- **Other schedulers** (cron-job.org, GitHub Actions, system cron): hit the same
  URL once a day with the secret header.

You can also send a reminder immediately from a campaign's detail page
(**Send reminder now**).

## Gmail app password

Nodemailer sends through each user's own Gmail using a
[Google App Password](https://support.google.com/accounts/answer/185833)
(requires 2-Step Verification). This 16-character password is stored on the
`User` and used only for sending — never the account's main password.

## Fonts / "Google Sans"

Google Sans is Google's **proprietary** brand font and is not published on
Google Fonts, so it can't be pulled via `next/font/google`. The app ships with
**Roboto** (Google's own typeface, which Google Sans is derived from) mapped to
the theme's `--font-sans`. To use genuine Google Sans, drop the licensed
`.woff2` files into `src/app/fonts/` and switch `src/app/layout.tsx` to
`next/font/local`:

```ts
import localFont from "next/font/local";
const sans = localFont({
  variable: "--font-sans",
  src: [
    { path: "./fonts/GoogleSans-Regular.woff2", weight: "400" },
    { path: "./fonts/GoogleSans-Medium.woff2", weight: "500" },
    { path: "./fonts/GoogleSans-Bold.woff2", weight: "700" },
  ],
});
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run seed` | Reset DB and load demo data |
| `npm run reminders` | Trigger the reminder job against a running server |
| `npm run lint` | ESLint |
