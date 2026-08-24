# REST API Reference

Full JSON CRUD API for campaigns, sales people, vendors, clients, and reminders.
Designed for use from Postman or any HTTP client.

Base URL = your `APP_URL` (e.g. `http://localhost:3000`).

Campaigns and attachments are **scoped to the logged-in user** — you only ever
see and modify your own.

Sales people, vendors and clients are a **shared directory**: `/api/sales`,
`/api/vendors` and `/api/clients` return the same global list to every user, and
any user may create, rename or delete an entry. A delete returns `409` while any
user's campaign still references it.

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
and loads each file from
`/api/campaigns/:id/locations/:locationId/attachments/:attachmentId` — which
checks ownership and then **redirects** to a short-lived Appwrite URL rather
than returning the bytes itself. Add `?download=1` to get an attachment
disposition instead of an inline one; a link click needs it, because `<a
download>` stops applying once the href crosses to another origin. The public
twin, `/api/share/:token/files/:attachmentId`, behaves the same way.

Bulk downloads and the PPT export are built **in the browser** — they fetch each
file from these routes, follow the redirect to Appwrite, and zip locally. No
endpoint returns a bundle.

### Uploading a file

Two calls, because Vercel caps a request body at ~4.5MB and the bytes therefore
can't come through this API at all.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `…/attachments/upload-ticket` | `{kind, imageTypeId?, photoType?, count}` | Authorises a batch. Returns `{endpoint, projectId, bucketId, jwt, ticket, fileIds, expiresAt}` |
| `POST` | `…/attachments` | `{ticket, fileId}` | Registers one file the client has uploaded. Returns the `AttachmentView` |

Between the two, the client uploads each file to Appwrite itself using the
returned `jwt` and the matching id from `fileIds`. The register call rejects a
`fileId` the ticket didn't cover, a file Appwrite has no record of, one already
registered (`409`), and anything whose stored mime type or size breaks the
limits — the filename, mime type and size are read back from Appwrite, never
taken from the request.

### Create body

Vendors, dates and status live on each **location**, not on the campaign.
`category` is the one classification field that is campaign-wide.

```json
{
  "clientId": "<client id>",
  "salesId": "<sales id>",
  "category": "Retail",            // optional, campaign-wide
  "locations": [
    {
      "city": "Mumbai",
      "location": "Bandra",
      "medium": "Billboard",       // media format
      "vendorId": "<vendor id>",
      "type": "Nonlit",            // optional: illumination
      "width": 20,                 // optional
      "height": 10,                // optional
      "sqft": 200,                 // optional; the UI prefills width × height
      "startDate": "2026-07-10",
      "midDate": "",               // optional: "" means not set
      "endDate": "2026-08-10",
      "status": "LIVE"             // optional: LIVE | ENDED | PENDING_CREATIVE
    }
  ]
}
```

Rules:
- `clientId` / `salesId` / `vendorId` must exist, else `400`. (They are a shared
  directory, so they need not be records you created.)
- At least one location is required.
- `endDate` must be on or after `startDate`, and `midDate` between the two, else `400`.
- `days` and the whole reminder schedule are computed from the dates.
- `width` / `height` / `sqft` accept `""` for "not set"; it is **not** stored as 0.

### Response shape

```json
{
  "id": "…",
  "category": "Retail",
  "term": 2,
  "termHistory": [
    {
      "term": 1,
      "renewedAt": "…",
      "locations": [
        { "locationId": "…", "startDate": "…", "midDate": null, "endDate": "…", "days": 30 }
      ]
    }
  ],
  "client": { "id": "…", "name": "Zenith Retail" },
  "sales":  { "id": "…", "name": "Ravi Kumar", "email": "ravi@company.com" },
  "locations": [
    {
      "id": "…",
      "city": "Mumbai", "location": "Bandra",
      "medium": "Billboard", "type": "Nonlit",
      "width": 20, "height": 10, "sqft": 200,
      "days": 32, "status": "LIVE",
      "vendor": { "id": "…", "name": "Urban Outdoor" },
      "startDate": "…", "midDate": null, "endDate": "…",
      "reminder": { "date": "…", "sent": false, "sentAt": null },
      "attachments": [ … ]
    }
  ]
}
```

List rows (`GET /api/campaigns`) use the same shape minus
`locations[].attachments` and `termHistory` — the row shows the current `term`,
not the archive.

### Update (PATCH) examples

`locations` is sent whole, not patched piecemeal: elements with an `id` are
updated, elements without one are inserted, and anything omitted is deleted
(along with its attachments).

```bash
# Change the campaign-wide category only
curl -b cookies.txt -X PATCH http://localhost:3000/api/campaigns/<id> \
  -H "Content-Type: application/json" -d '{"category":"Retail"}'

# Replace the locations array
curl -b cookies.txt -X PATCH http://localhost:3000/api/campaigns/<id> \
  -H "Content-Type: application/json" \
  -d '{"locations":[{"id":"<loc id>","city":"Mumbai","location":"Bandra","medium":"Billboard","vendorId":"<vendor id>","type":"Lit","width":20,"height":10,"sqft":200,"startDate":"2026-07-10","midDate":"","endDate":"2026-08-10","status":"LIVE"}]}'
```

### Renew (next term)

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/campaigns/<id>/renew \
  -H "Content-Type: application/json" \
  -d '{"locations":[{"id":"<loc id>","city":"Mumbai","location":"Bandra","medium":"Billboard","vendorId":"<vendor id>","startDate":"2026-09-10","midDate":"","endDate":"2026-10-10"}]}'
```

Renewing **updates this campaign** — it never creates a second one. The dates it
is currently running on are archived into `termHistory`, `term` goes up by one,
and the locations take the new dates with a freshly restarted reminder series.

Unlike `PATCH`, a location left out of the body is **not** deleted: it simply
wasn't rebooked, so it keeps its dates and its photos and drops to `ENDED`.
Locations may be added (they join from this term on) but can only be removed via
`PATCH`, which cascades their attachment deletes properly.

Responds with the full `CampaignView`, including the new `term` and
`termHistory`. Every attachment carries the `term` it was uploaded under, so
past periods' photos stay on the campaign and stay distinguishable.

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
