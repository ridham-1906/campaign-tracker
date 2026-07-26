# REST API Reference

Full JSON CRUD API for campaigns, sales people, vendors, clients, and reminders.
Designed for use from Postman or any HTTP client.

Base URL = your `APP_URL` (e.g. `http://localhost:3000`).

All data is **scoped to the logged-in user** — you only ever see and modify your
own records.

## Authentication

These resource endpoints use the **same session cookie** as the web app. Log in
once via the API; the returned `campaign_session` cookie authenticates every
subsequent call.

> In Postman, cookies are stored automatically per domain. Just call
> `POST /api/auth/login` first, then the other requests reuse the cookie.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | `{ email, password }` | Sets `campaign_session` cookie; returns `{ id, name, email }` |
| `POST` | `/api/auth/logout` | — | Clears the cookie |
| `GET` | `/api/auth/me` | — | Current user `{ userId, name, email }` |

```bash
# 1. Log in (saves the cookie to cookies.txt)
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@company.com","password":"your-password"}'

# 2. Use the cookie on every other call
curl -b cookies.txt http://localhost:3000/api/campaigns
```

> Accounts are created by an admin via [`POST /api/users`](./api.md#post-apiusers)
> — there is no signup.

Any resource call without a valid session returns **`401 Unauthorized`**.

## Conventions

- Request bodies are JSON (`Content-Type: application/json`).
- IDs are Mongo ObjectIds. A malformed/unknown id returns **`404`**.
- Validation errors return **`400`** with `{ error, issues }`.
- Dates accept ISO strings (`2026-08-10` or full ISO). They are normalized to
  the start of the day.
- `PATCH` updates are partial — send only the fields you want to change.

### List endpoints are paginated

**Breaking change.** `GET /api/campaigns`, `/api/sales`, `/api/vendors` and
`/api/clients` used to return a bare array of every record. They now return a
page:

```json
{ "rows": [ ... ], "total": 137, "page": 1, "limit": 20 }
```

Shared query parameters:

| Param | Default | Notes |
| --- | --- | --- |
| `page` | `1` | 1-based |
| `limit` | `20` | capped at `100` |
| `q` | — | case-insensitive substring search, max 100 chars |
| `sort` | per endpoint | must be one of the endpoint's sort keys |
| `dir` | `asc` | `asc` \| `desc` |

Junk values fall back to the default rather than erroring — a stale bookmark
should land on page 1, not a `400`.

For the complete unpaginated list a combobox needs, use the `/options`
endpoints (`/api/clients/options`, `/api/vendors/options`,
`/api/sales/options`, `/api/campaigns/options`). Those return bare arrays.

---

## Sales people

`name`, `email`.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/sales` | — | Page of `{id, name, email, count}`. Sort keys: `name` |
| `GET` | `/api/sales/options` | — | All, as `{id, name, email}` |
| `POST` | `/api/sales` | `{ name, email }` | Create → `201` |
| `GET` | `/api/sales/:id` | — | One |
| `PATCH` | `/api/sales/:id` | `{ name?, email? }` | Update |
| `DELETE` | `/api/sales/:id` | — | `409` if used by a campaign |

`count` is how many campaigns reference the record, computed for the rows on
the current page only — which is why it isn't a sort key.

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/sales \
  -H "Content-Type: application/json" \
  -d '{"name":"Ravi Kumar","email":"ravi@company.com"}'
```

## Vendors

`name`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/vendors` | — (page of `{id, name, count}`; sort key `name`) |
| `GET` | `/api/vendors/options` | — (all, as `{id, name}`) |
| `POST` | `/api/vendors` | `{ name }` |
| `GET` | `/api/vendors/:id` | — |
| `PATCH` | `/api/vendors/:id` | `{ name }` |
| `DELETE` | `/api/vendors/:id` | — (`409` if in use) |

A vendor's `count` is campaigns, not locations: a campaign using the same
vendor on several of its locations counts once.

## Clients

`name`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/clients` | — (page of `{id, name, count}`; sort key `name`) |
| `GET` | `/api/clients/options` | — (all, as `{id, name}`) |
| `POST` | `/api/clients` | `{ name }` |
| `GET` | `/api/clients/:id` | — |
| `PATCH` | `/api/clients/:id` | `{ name }` |
| `DELETE` | `/api/clients/:id` | — (`409` if in use) |

---

## Campaigns

Creating a campaign **auto-creates a reminder** 7 days before the end date
(override with `reminderDate`).

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/campaigns` | — | Page of campaigns. **Omits `locations[].attachments`** |
| `GET` | `/api/campaigns/stats` | — | Status counts across the whole result set |
| `GET` | `/api/campaigns/options` | — | All, as `{id, clientName, locationCount}` |
| `POST` | `/api/campaigns` | see below | Create → `201` |
| `GET` | `/api/campaigns/:id` | — | One, **with** attachments |
| `PATCH` | `/api/campaigns/:id` | any subset | Update |
| `DELETE` | `/api/campaigns/:id` | — | Also deletes its attachments and their stored files |
| `POST` | `/api/campaigns/:id/send-reminder` | — | Email the sales person now |

The list omits attachment metadata, which was roughly half its payload and is
never rendered in a campaign table. Fetch a single campaign for the full tree.

**Sort keys:** `endDate` (default — soonest-ending location), `dates`
(earliest start), `client`.

**`q`** matches the client name, the sales name, and any location's name,
city, type or vendor name.

**`status`** filters by a rollup over the campaign's locations:

| Value | Meaning |
| --- | --- |
| `all` *(default)* | no filter |
| `LIVE` | any location live |
| `EXPIRING` | any location live and ending within 7 days |
| `ENDED` | every location ended |
| `SENT_TODAY` | a reminder went out today |
| `CREATIVE` | any location pending creative and not past its end date |

`GET /api/campaigns/stats` returns
`{ total, live, expiring, ended, sentToday, creativePending }`. It accepts `q`
(so the counts reflect a search) but not `status` — the counts *are* the
status breakdown. Totals can't be derived from a single page, hence the
separate endpoint.

"Today" is the current calendar day in IST, matching the reminder cron's own
day boundary.

## Images

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/images` | Page of campaign summaries — one row per campaign that has files |

Sort keys: `uploadedAt` (default, descending), `client`, `locations`, `count`.
`q` matches client name, city and location name.

Each row is `{id, clientName, locationCount, fileCount, latestUploadedAt}`,
where `id` is the campaign id. Headline counts only — which locations and which
file types is the preview dialog's business, not the table's. Cities and
location names are matched by `q` but never returned.

The files themselves aren't listed here. The preview dialog reads
`GET /api/campaigns/:id`, which already carries every location's attachments,
and streams each file from
`/api/campaigns/:id/locations/:locationId/attachments/:attachmentId`.

### Create body

```json
{
  "clientId": "<client id>",
  "salesId": "<sales id>",
  "vendorId": "<vendor id>",
  "city": "Mumbai",
  "type": "Billboard",
  "location": "Bandra",
  "startDate": "2026-07-10",
  "endDate": "2026-08-10",
  "status": "ACTIVE",          // optional: ACTIVE | PAUSED | COMPLETED
  "reminderDate": "2026-08-03" // optional: defaults to endDate - 7 days
}
```

Rules:
- `clientId` / `salesId` / `vendorId` must be **your** records, else `400`.
- `endDate` must be on or after `startDate`, else `400`.
- `days` is computed automatically.

### Response shape

```json
{
  "id": "…",
  "city": "Mumbai", "type": "Billboard", "location": "Bandra",
  "days": 32, "status": "ACTIVE",
  "startDate": "…", "endDate": "…",
  "sales":  { "id": "…", "name": "Ravi Kumar", "email": "ravi@company.com" },
  "vendor": { "id": "…", "name": "Urban Outdoor" },
  "client": { "id": "…", "name": "Zenith Retail" },
  "reminder": { "id": "…", "date": "…", "sent": false, "sentAt": null }
}
```

### Update (PATCH) examples

```bash
# Change status only
curl -b cookies.txt -X PATCH http://localhost:3000/api/campaigns/<id> \
  -H "Content-Type: application/json" -d '{"status":"COMPLETED"}'

# Move the reminder date (re-arms it if in the future)
curl -b cookies.txt -X PATCH http://localhost:3000/api/campaigns/<id> \
  -H "Content-Type: application/json" -d '{"reminderDate":"2026-08-01"}'
```

### Send reminder now

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/campaigns/<id>/send-reminder
# 200 { "ok": true, "sentTo": "ravi@company.com" }
# 400 { "error": "Email failed: …" }  (e.g. bad Gmail app password)
```

---

## Reminders

There is **no `/api/reminders` endpoint.** The standalone `Reminder` model was
folded into the embedded locations: each location carries its own
`reminderDate`, `reminderSent`, `reminderSentAt` and `creativeReminderSentAt`,
which the campaign endpoints return and the cron updates. Schedules are derived
from the end date, so change the date to move the reminder.

> The daily job ([`/api/cron/reminders`](./api.md#post-apicronreminders))
> processes **every** due reminder, so extra reminders you create here will fire
> too.

---

## Status codes summary

| Code | Meaning |
| --- | --- |
| `200` | OK |
| `201` | Created |
| `400` | Validation failed / bad reference / bad JSON |
| `401` | Not logged in |
| `404` | Resource not found (or not yours) |
| `409` | Can't delete — record is used by a campaign |
