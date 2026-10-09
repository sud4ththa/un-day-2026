# Stall dashboard

This Netlify site is the stall dashboard. Counts, `data.json`, and the per-stall
PDFs (page 1 totals, page 2 names and phones) are written by a scheduled
function into a private blob store. They are served only after an SMS code.

Three people can sign in: Sudaththa, Subraja, and Zainab. Each code goes to
that person's mobile through Twilio Verify. A successful code lasts 12 hours.

The login page in `public/` is the only file this site publishes. Nothing with
names is a static file. A function checks the session cookie, then reads the
blobs.

Phone numbers stay in Netlify environment variables. The browser receives a
masked number (`+94` and the last two digits).

Sheet ids stay in `STALL_SHEETS`. Do not commit them. This repository is public.

## 1. Twilio

1. In the Twilio console, note the **Account SID** and **Auth Token**.
2. Create a [Verify service](https://console.twilio.com/us1/service/verify). SMS is enough.
3. Enable Sri Lanka (`+94`) for SMS geo permissions if the account restricts destinations.
4. Copy the Verify **Service SID** (`VA…`).

## 2. Google Sheets

1. In Google Cloud, create or choose a project.
2. Enable the **Google Sheets API** for that project.
3. Create a service account (IAM → Service accounts).
4. Add a JSON key for that account.
5. Copy the service account email (`client_email` in the key). It looks like `something@project.iam.gserviceaccount.com`.
6. Share each stall **response** spreadsheet with that email as **Viewer**. These are the 11 sheets behind the forms, not the public form links:

   Sri Lanka, Japan, Australia/NZ/Philippines/Indonesia, Singapore/Malaysia/Vietnam/Thailand, India, USA/Canada, Europe, Middle East, China, Maldives, UN Zone / Palestine.

The function reads with the key in `GOOGLE_SA_KEY_JSON`. If one sheet cannot be read, that stall keeps its last good counts and PDF. The log line is only the stall key (`sri-lanka`, `japan`, …). Names, phones, and emails are not logged.

## 3. Netlify site

Create a new site from this repository. Do not reuse another site, and do not publish the repository root.

| Setting | Value |
| --- | --- |
| Base directory | `dashboard-gate` |
| Build command | `node scripts/vendor-config.mjs && npm ci --omit=dev` |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node version | 22 |

Set every variable below to the **Production** scope only, so deploy previews cannot send texts or read the sheets. Scheduled functions run on production deploys only.

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service SID (`VA…`) |
| `PHONE_SUDATHTHA` | E.164, Sri Lanka, for Sudaththa |
| `PHONE_SUBRAJA` | E.164, Sri Lanka, for Subraja |
| `PHONE_ZAINAB` | E.164, Sri Lanka, for Zainab |
| `SESSION_SECRET` | `openssl rand -base64 32` (at least 32 characters) |
| `GOOGLE_SA_KEY_JSON` | The entire service-account JSON key, one line is fine |
| `STALL_SHEETS` | JSON map of stall key to spreadsheet id and tab gid. Example shape, with placeholders only: `{"sri-lanka":{"id":"SHEET_ID","gid":0},"japan":{"id":"SHEET_ID","gid":0},"australia":{"id":"SHEET_ID","gid":0},"sea":{"id":"SHEET_ID","gid":0},"india":{"id":"SHEET_ID","gid":0},"americas":{"id":"SHEET_ID","gid":0},"europe":{"id":"SHEET_ID","gid":0},"middle-east":{"id":"SHEET_ID","gid":0},"china":{"id":"SHEET_ID","gid":0},"maldives":{"id":"SHEET_ID","gid":0},"un-zone":{"id":"SHEET_ID","gid":0}}` |

`gid` is the numeric tab id from the sheet URL (`#gid=`). Use `0` for the first tab.

After the first production deploy, the function `refresh-scheduled` runs at
07 and 37 minutes past each hour from 01:00 through 16:00 UTC. That is about
every 30 minutes from 07:07 to 22:07 Asia/Colombo. A run that would fall at
06:37 Colombo is skipped. The minutes are off the hour on purpose.

Anyone signed in can press **Refresh now**. That is `POST /api/refresh` with
the session cookie. A second refresh inside a minute is refused.

Counts and PDFs land in the site blob store `stall-dashboard` (`us-east-2`).
There is no hourly job on a build machine.

## What the gate allows

- `POST /api/send` with `{ "who": "sudaththa" | "subraja" | "zainab" }` only. A phone number in the body is ignored.
- 3 texts per person and 8 per IP address, each per 15 minutes.
- 10 code checks per person per 15 minutes. Twilio's own limits still apply.
- `GET /view/…` only with a valid cookie. Anything else is redirected to the sign-in page and the file is not in the response.
- `POST /api/refresh` only with a valid cookie.
