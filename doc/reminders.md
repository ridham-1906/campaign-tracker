# Reminders

The core feature: sales people are emailed automatically before a campaign ends.

## How it works

1. **When a campaign is created**, a `Reminder` is created with a `date`.
   - Default = **7 days before the campaign's end date**.
   - You can set any date on the campaign form (editable later too).
2. **Once a day**, the reminder job runs (`/api/cron/reminders`). It:
   - Finds every reminder whose `date` is **today** and `sent` is `false`.
   - Loads the campaign, its sales person, vendor, client, and the owning
     backend user (for the sender Gmail).
   - Emails the **sales person** a "campaign expiring soon" message.
   - Marks the reminder `sent = true`, `sentAt = now`.
3. **Idempotent:** because reminders are flagged as sent, running the job more
   than once in a day never double-sends. Send failures stay unsent and are
   retried on the next run.

### What gets skipped

A due reminder is skipped (counted in `skipped`, not emailed) when:

- The campaign was deleted.
- The campaign status is **Completed**.
- The campaign is missing a sales person or owner.

### Editing behavior

Moving a campaign's reminder date to a **future** day re-arms it (`sent` resets),
so it can fire again. Past/completed reminders stay as-is.

### Manual send

From a campaign's detail page, **Send reminder now** emails the sales person
immediately and marks the reminder sent — useful for a one-off nudge.

## The email

- **From:** the backend user's own Gmail account (their `email` + `appPassword`).
- **To:** the campaign's sales person email.
- **Subject:** `Reminder: <Client> campaign in <City> expires in <N> days`
- **Body:** client, vendor, type, city, location, end date, days left, and a
  link back to the app (`APP_URL`).

## Gmail setup

Nodemailer sends through Gmail using an **App Password** (not the account
password):

1. The sender Google account must have **2-Step Verification** enabled.
2. Create an app password: <https://support.google.com/accounts/answer/185833>
3. Use the 16-character value as the user's `appPassword` when creating them via
   [`POST /api/users`](./api.md#post-apiusers).

The app password is **encrypted at rest** (AES-256-GCM using `ENCRYPTION_KEY`)
and decrypted only in-memory at send time — it is never stored or logged in
plaintext.

> Error `535-5.7.8 Username and Password not accepted` means the app password is
> wrong, revoked, or a placeholder. Re-create the user with a valid one.

## Scheduling the daily run

The job is just an HTTP call — schedule it once a day with whatever you have.

### Option A — Vercel Cron (if deployed on Vercel)

[`vercel.json`](../vercel.json) already defines:

```json
{ "crons": [{ "path": "/api/cron/reminders", "schedule": "0 4 * * *" }] }
```

Runs daily at **04:00 UTC**. Set `CRON_SECRET` in the Vercel project env —
Vercel Cron automatically sends it as `Authorization: Bearer <CRON_SECRET>`.
Adjust the [cron expression](https://crontab.guru/) for your timezone.

### Option B — External scheduler (cron-job.org, GitHub Actions, etc.)

Hit the endpoint once a day with the secret header:

```
POST https://your-app.com/api/cron/reminders
Authorization: Bearer <CRON_SECRET>
```

### Option C — System cron (self-hosted)

```cron
# every day at 09:00 server time
0 9 * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.com/api/cron/reminders
```

### Option D — Local/manual

```bash
npm run dev         # server running
npm run reminders   # trigger once
```

## Timezone note

"Today" is computed from the **server's local time** (start of day). Pick a cron
time that sits comfortably inside the target day for your team's timezone (e.g.
early morning) so reminders go out on the intended date.
