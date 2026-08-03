# User Guide

How to use Campaign Tracker day-to-day. **Campaigns and their photos are yours**
— you only see the ones you created. **Clients, vendors and sales people are
shared**: one list the whole team reads from and adds to, so everyone books
against the same names.

## 1. Log in

Go to the app URL. You'll land on `/login`. Enter the email and password an
admin created for you. Sessions last **7 days**; use **Log out** (top right) to
end one early.

> No self-signup — if you don't have an account, ask an admin to create one via
> the [users API](./api.md#post-apiusers).

## 2. Add your people first

Open **Sales · Vendors · Clients** from the top nav. A campaign needs one of
each, so add them before creating campaigns.

These three lists are **shared with the whole team** — anyone can see, add,
rename or remove an entry, and everyone picks from the same list. Check whether
a name is already there before adding it, so the same client doesn't end up
listed twice.

| Section | Fields | Used for |
| --- | --- | --- |
| **Sales people** | Name + **Email** | Recipients of the expiry reminder emails |
| **Vendors** | Name | The media/space vendor |
| **Clients** | Name | The advertiser/brand |

- Click **Add** to create an entry.
- **Delete** is blocked while a person is used by any campaign (the button shows
  how many campaigns reference them). Remove or reassign those campaigns first.

## 3. Create a campaign

Click **+ New campaign** on the dashboard. It opens a four-step wizard.

**Step 1 — Details.** Pick the **Client** and the **Sales person** from what you
added in step 2. The sales person receives every reminder for the campaign.

**Step 2 — Upload Excel** *(optional, and only when creating)*. Drop in a
campaign sheet and every row becomes a location, so you don't type them in by
hand. One campaign per file, one row per location. The importer needs **Vendor,
City, Medium, Location, Start date** and **End date**, and also picks up
**Category, W, H, SQFT** and **Type** when the sheet has them. Anything it
couldn't match — an unknown vendor, a missing date — is listed under *Needs
review*, and you can fix it in the next steps. Older sheets whose media format
sits in a column called *Type* still import correctly.

**Step 3 — Locations.**

| Field | Notes |
| --- | --- |
| **Category** | One value for the whole campaign, at the top of the step — not per location |
| **Location** / **City** | Where this placement runs |
| **Medium** | Free text — e.g. Billboard, Gantry, LED, Bus Shelter |
| **Vendor** | Chosen per location, so one campaign can span several vendors |
| **W** / **H** | Site width and height |
| **SQFT** | Fills in as **W × H** while you type, and can be overwritten for an odd-shaped site |
| **Type** | Illumination — e.g. Lit, Nonlit |

**Add location** repeats the card for the next placement. Category, W, H, SQFT
and Type are all optional.

**Step 4 — Dates & reminders.** Set **Start**, optional **Mid** and **End**
dates per location; the duration in days and the reminder schedule are worked
out for you, and **Next reminder** previews when the first one goes out. With
more than one location you also get **Apply dates to all**, plus a filter bar
for finding a placement in a long list.

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
- **Renew** — books the next term without retyping it. Opens **New campaign**
  with the client, sales person and every placement already filled in, and jumps
  straight to the dates. Each location is suggested to start the day after it
  last ended (or today, if that's already past) and to run for the same length
  as before; change any of them before saving. The campaign you renewed is left
  exactly as it was — the renewal is saved as a separate campaign, with no
  photos carried over.
- **Delete** — removes the campaign and its reminder.

## 6. How reminders reach sales people

You don't have to do anything for scheduled reminders — a daily job handles
them. On a campaign's reminder date, its sales person gets an email like:

> **Subject:** Reminder: Acme Corp campaign in Mumbai expires in 7 days

The email comes **from your own Gmail account** (configured when your user was
created). Reminders are sent once and marked as sent, so nobody gets duplicates.

See [reminders.md](./reminders.md) for the full mechanism.
