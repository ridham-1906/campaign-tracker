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

---

## Sales people

`name`, `email`.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/sales` | — | List |
| `POST` | `/api/sales` | `{ name, email }` | Create → `201` |
| `GET` | `/api/sales/:id` | — | One |
| `PATCH` | `/api/sales/:id` | `{ name?, email? }` | Update |
| `DELETE` | `/api/sales/:id` | — | `409` if used by a campaign |

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/sales \
  -H "Content-Type: application/json" \
  -d '{"name":"Ravi Kumar","email":"ravi@company.com"}'
```

## Vendors

`name`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/vendors` | — |
| `POST` | `/api/vendors` | `{ name }` |
| `GET` | `/api/vendors/:id` | — |
| `PATCH` | `/api/vendors/:id` | `{ name }` |
| `DELETE` | `/api/vendors/:id` | — (`409` if in use) |

## Clients

`name`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/api/clients` | — |
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
| `GET` | `/api/campaigns` | — | List (with populated client/sales/vendor + reminder) |
| `POST` | `/api/campaigns` | see below | Create → `201` |
| `GET` | `/api/campaigns/:id` | — | One |
| `PATCH` | `/api/campaigns/:id` | any subset | Update |
| `DELETE` | `/api/campaigns/:id` | — | Also deletes its reminder |
| `POST` | `/api/campaigns/:id/send-reminder` | — | Email the sales person now |

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

Usually managed through the campaign (one per campaign by default), but exposed
directly for full control. Reminders are always tied to a campaign you own.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/reminders` | — | All your reminders. Filter: `?campaignId=<id>` |
| `POST` | `/api/reminders` | `{ campaignId, date, sent? }` | Create → `201` |
| `GET` | `/api/reminders/:id` | — | One |
| `PATCH` | `/api/reminders/:id` | `{ date?, sent? }` | Setting `sent:true` stamps `sentAt` |
| `DELETE` | `/api/reminders/:id` | — | Delete |

```bash
# Schedule an extra reminder for a campaign
curl -b cookies.txt -X POST http://localhost:3000/api/reminders \
  -H "Content-Type: application/json" \
  -d '{"campaignId":"<id>","date":"2026-08-05"}'

# Mark a reminder as already sent (won't be emailed by the cron)
curl -b cookies.txt -X PATCH http://localhost:3000/api/reminders/<id> \
  -H "Content-Type: application/json" -d '{"sent":true}'
```

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
