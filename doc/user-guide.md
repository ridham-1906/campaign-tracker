# User Guide

How to use Campaign Tracker day-to-day. Everything you see is scoped to **your**
account — you only see the campaigns and people you created.

## 1. Log in

Go to the app URL. You'll land on `/login`. Enter the email and password an
admin created for you. Sessions last **7 days**; use **Log out** (top right) to
end one early.

> No self-signup — if you don't have an account, ask an admin to create one via
> the [users API](./api.md#post-apiusers).

## 2. Add your people first

Open **Sales · Vendors · Clients** from the top nav. A campaign needs one of
each, so add them before creating campaigns.

| Section | Fields | Used for |
| --- | --- | --- |
| **Sales people** | Name + **Email** | Recipients of the expiry reminder emails |
| **Vendors** | Name | The media/space vendor |
| **Clients** | Name | The advertiser/brand |

- Click **Add** to create an entry.
- **Delete** is blocked while a person is used by any campaign (the button shows
  how many campaigns reference them). Remove or reassign those campaigns first.

## 3. Create a campaign

Click **+ New campaign** on the dashboard. Fill in:

| Field | Notes |
| --- | --- |
| **Client / Sales person / Vendor** | Chosen from what you added in step 2 |
| **Type** | Free text — e.g. Billboard, Hoarding, Digital, Bus Shelter |
| **City** / **Location** | Where the campaign runs |
| **Start date** / **End date** | Duration (days) is calculated automatically |
| **Reminder date** | Defaults to **7 days before the end date**; change it to any date you want |
| **Status** | Active, Paused, or Completed |

Save with **Create campaign**.

## 4. Track status on the dashboard

The dashboard lists all your campaigns, sorted by end date, with summary cards
at the top (Total / Active / Expiring soon / Expired).

Each campaign shows a **status badge**, derived automatically from its dates and
status field:

| Badge | Meaning |
| --- | --- |
| **Upcoming** | Start date is in the future |
| **Active** | Running, more than 7 days left |
| **Expiring soon** | Running, **7 or fewer days** to the end date |
| **Expired** | End date has passed |
| **Paused** | Status manually set to Paused |
| **Completed** | Status manually set to Completed |

The **Days left** column turns amber within 7 days and red once expired.

## 5. View, edit, delete

Click a campaign row (the client name) to open its detail page:

- **Edit** — change any field. Moving the reminder date to a future day
  re-arms it (it can send again).
- **Send reminder now** — immediately emails the sales person about this
  campaign's expiry, without waiting for the scheduled date. Marks the reminder
  as sent.
- **Delete** — removes the campaign and its reminder.

## 6. How reminders reach sales people

You don't have to do anything for scheduled reminders — a daily job handles
them. On a campaign's reminder date, its sales person gets an email like:

> **Subject:** Reminder: Acme Corp campaign in Mumbai expires in 7 days

The email comes **from your own Gmail account** (configured when your user was
created). Reminders are sent once and marked as sent, so nobody gets duplicates.

See [reminders.md](./reminders.md) for the full mechanism.
