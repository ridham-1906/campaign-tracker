# Getting Started

## 1. Prerequisites

- **Node.js 20+**
- A **MongoDB** instance — any of:
  - Local `mongod` (default `mongodb://127.0.0.1:27017`)
  - Docker: `docker run -d -p 27017:27017 --name mongo mongo:7`
  - MongoDB Atlas (cloud)

## 2. Install

```bash
npm install
```

## 3. Environment variables

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | ✅ | MongoDB connection string. Local: `mongodb://127.0.0.1:27017/campaign_tracker` · Atlas: `mongodb+srv://user:pass@cluster/campaign_tracker` |
| `JWT_SECRET` | ✅ | Long random string used to sign login session cookies |
| `CRON_SECRET` | ✅ | Secret required to trigger the daily reminder job |
| `REGISTER_SECRET` | ✅ | Secret required to create users via `POST /api/users` |
| `ENCRYPTION_KEY` | ✅ | 32-byte key (64 hex chars) used to encrypt each user's Gmail app password at rest (AES-256-GCM) |
| `APP_URL` | ✅ | Public base URL used inside reminder emails (e.g. `http://localhost:3000`) |

Generate strong secrets, for example:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `.env` is git-ignored. Never commit real secrets. `.env.example` is the safe,
> committed template.

## 4. Seed demo data (optional)

Loads one demo backend user plus sample sales/vendors/clients/campaigns so you
can click around immediately. **This wipes existing collections first.**

```bash
npm run seed
```

Demo login: **demo@company.com** / **password123**

> The demo user's Gmail app password is a placeholder, so reminder emails will
> fail to send until you set a real one (create a real user via the API instead
> — see [api.md](./api.md)).

## 5. Create real users

There is no signup screen. Provision users through the admin API — see
[api.md → POST /api/users](./api.md#post-apiusers). Minimal example:

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer $REGISTER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ravi Kumar","email":"ravi@company.com","password":"a-strong-password","appPassword":"gmail-app-password"}'
```

## 6. Run

```bash
npm run dev        # development (http://localhost:3000)
# or
npm run build && npm start   # production
```

Open the app — you'll be redirected to `/login`.

## Scripts reference

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run seed` | Reset the DB and load demo data |
| `npm run reminders` | Trigger the reminder job against a running server |
| `npm run lint` | Run ESLint |

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `MONGODB_URI is not set` | Add it to `.env` |
| Port 3000 in use → app starts on 3001/3002 | Another process holds 3000; use the printed URL or free the port |
| Reminder email fails: `535 Username and Password not accepted` | The user's Gmail **app password** is wrong/placeholder — see [reminders.md](./reminders.md#gmail-setup) |
| `401 Unauthorized` from an API | Missing/incorrect `CRON_SECRET` or `REGISTER_SECRET` |
