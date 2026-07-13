# Admin & Automation API

Two special endpoints secured by a **shared secret** (not a login session):
creating users and running the reminder job. For day-to-day resource CRUD
(campaigns, sales, vendors, clients, reminders) see the
[REST API reference](./rest-api.md) instead.

Both endpoints below are secured by a secret you set in `.env` and pass as a
`Bearer` token.

Base URL: your `APP_URL` (e.g. `http://localhost:3000` in dev).

---

## POST /api/users

Create a backend user (login account). There is **no public signup** — this is
how you provision the 2-3 people who use the tool, e.g. from Postman.

**Auth:** `Authorization: Bearer <REGISTER_SECRET>`
(alternatively the header `x-register-secret: <REGISTER_SECRET>`)

### Request body (JSON)

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | required, non-empty |
| `email` | string | required, valid email, must be unique |
| `password` | string | required, **min 6 characters** — used to log in |
| `appPassword` | string | required — the sender Gmail **app password** for this user's reminder emails |

### Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `201 Created` | `{ "id", "name", "email" }` | User created |
| `400 Bad Request` | `{ "error": "Validation failed", "issues": [...] }` | Missing/invalid fields or bad JSON |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` | Missing/incorrect secret |
| `409 Conflict` | `{ "error": "A user with this email already exists" }` | Duplicate email |
| `500` | `{ "error": "REGISTER_SECRET is not configured" }` | Server env not set |

### Example — curl

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $REGISTER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Ravi Kumar",
        "email": "ravi@company.com",
        "password": "a-strong-password",
        "appPassword": "abcd efgh ijkl mnop"
      }'
```

```json
// 201
{ "id": "6a50bfc789b8cd13934cf3fc", "name": "Ravi Kumar", "email": "ravi@company.com" }
```

### Example — Postman

1. Method **POST**, URL `http://localhost:3000/api/users`
2. **Authorization** tab → Type **Bearer Token** → paste your `REGISTER_SECRET`
3. **Body** tab → **raw** → **JSON**, paste the object above
4. **Send**

> The login password is stored **bcrypt-hashed**. The Gmail app password is
> **encrypted at rest** (AES-256-GCM via `ENCRYPTION_KEY`) and decrypted only at
> the moment an email is sent. To change either, re-create the user.

---

## POST /api/cron/reminders

Run the daily reminder job: find every unsent reminder dated **today** and email
the campaign's sales person. Also accepts **GET** for easy browser/cron testing.

**Auth:** `Authorization: Bearer <CRON_SECRET>`
(alternatively `?secret=<CRON_SECRET>` in the query string)

### Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `200 OK` | run summary (below) | Job ran |
| `401 Unauthorized` | `{ "error": "Unauthorized" }` | Missing/incorrect secret |
| `500` | `{ "error": "CRON_SECRET is not configured" }` | Server env not set |

### 200 summary shape

```json
{
  "ok": true,
  "date": "2026-07-10T00:00:00.000Z",  // day processed (start of day)
  "due": 3,        // reminders scheduled for today
  "sent": 2,       // emails successfully sent (marked sent)
  "skipped": 1,    // campaign deleted / completed / missing sales person
  "errors": [      // per-reminder send failures (not marked sent; retried next run)
    { "campaignId": "6a50...", "error": "Invalid login: 535-5.7.8 ..." }
  ]
}
```

The job is **idempotent**: sent reminders are flagged, so re-running the same day
won't re-send. Failures are left unsent and retried on the next run.

### Example — curl

```bash
# Bearer header
curl -X POST http://localhost:3000/api/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET"

# or query param (handy for GET / browser)
curl "http://localhost:3000/api/cron/reminders?secret=$CRON_SECRET"
```

### Example — npm helper

With the dev server running:

```bash
npm run reminders   # POSTs to /api/cron/reminders using CRON_SECRET from .env
```

See [reminders.md](./reminders.md) for scheduling this daily in production.

---

## Notes on authentication

| Secret | Guards | Header |
| --- | --- | --- |
| `REGISTER_SECRET` | `POST /api/users` | `Authorization: Bearer …` or `x-register-secret` |
| `CRON_SECRET` | `/api/cron/reminders` | `Authorization: Bearer …` or `?secret=` |
| `JWT_SECRET` | Web UI login sessions (cookie `campaign_session`) | set automatically on login |
| `ENCRYPTION_KEY` | Encrypts stored Gmail app passwords (not an auth secret) | — |

Keep all of these private. Rotating a secret immediately invalidates callers
using the old value (and, for `JWT_SECRET`, logs everyone out). **Rotating
`ENCRYPTION_KEY` makes existing encrypted app passwords undecryptable** — re-
create the affected users afterwards.
