# Campaign Tracker — Documentation

Internal tool for the backend sales team to **track campaign status** and
**automatically email sales people before their campaigns expire**.

## Contents

| Doc | What's in it |
| --- | --- |
| [getting-started.md](./getting-started.md) | Prerequisites, environment variables, install, seed, run |
| [user-guide.md](./user-guide.md) | How to use the app day-to-day (login, campaigns, people, reminders) |
| [rest-api.md](./rest-api.md) | **Full JSON CRUD API** — campaigns, sales, vendors, clients, reminders |
| [api.md](./api.md) | Admin/automation endpoints — create users, trigger the reminder job |
| [reminders.md](./reminders.md) | How the reminder system works and how to schedule it |
| [architecture.md](./architecture.md) | Stack, data model, project layout, auth |

## The 30-second version

1. There is **no public signup**. An admin creates the 2-3 backend users via the
   [`POST /api/users`](./api.md#post-apiusers) endpoint (secret-protected).
2. Each backend user logs in, adds their **sales people, vendors, and clients**,
   then creates **campaigns**.
3. Every campaign gets a **reminder** dated 7 days before it ends (editable).
4. A **daily cron job** finds reminders due today and emails the campaign's
   sales person from the backend user's own Gmail.

## Quick links

- App entry: `http://localhost:3000` → redirects to `/login`
- Create users: `POST /api/users`
- Run reminders: `POST /api/cron/reminders`
