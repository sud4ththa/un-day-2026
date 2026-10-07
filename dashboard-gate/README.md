# Stall dashboard sign-in

The counts page and the per-stall contact PDFs are served only after an SMS code.
Three people can sign in: Sudaththa, Subraja, and Zainab. Each code goes to that
person's mobile through Twilio Verify. A successful code lasts 12 hours.

The login page in `public/` is the only file this Netlify site publishes.
`data.json`, the counts HTML, and `sheets/*.pdf` are not in the site publish
directory and are not committed. A function reads them from a Netlify Blobs
store after it has checked the session cookie.

Phone numbers stay in Netlify environment variables. The browser receives a
masked number (`+94` and the last two digits).

## 1. Twilio

1. In the Twilio console, note the **Account SID** and **Auth Token**.
2. Create a [Verify service](https://console.twilio.com/us1/service/verify). SMS is enough.
3. Enable Sri Lanka (`+94`) for SMS geo permissions if the account restricts destinations.
4. Copy the Verify **Service SID** (`VA…`).

## 2. Netlify site

Create a new site from this repository. Do not reuse the food-portal site.

| Setting | Value |
| --- | --- |
| Base directory | `dashboard-gate` |
| Build command | `npm ci --omit=dev` (already in `netlify.toml`) |
| Publish directory | `public` |
| Functions directory | `netlify/functions` |
| Node version | 22 |

The publish directory must stay `dashboard-gate/public`. Publishing the
repository root would put the counts page on this host without the gate.

Set every variable below to the **Production** scope only, so deploy previews
cannot send texts:

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Account SID |
| `TWILIO_AUTH_TOKEN` | Auth token |
| `TWILIO_VERIFY_SERVICE_SID` | Verify service SID (`VA…`) |
| `PHONE_SUDATHTHA` | E.164, Sri Lanka, for Sudaththa |
| `PHONE_SUBRAJA` | E.164, Sri Lanka, for Subraja |
| `PHONE_ZAINAB` | E.164, Sri Lanka, for Zainab |
| `SESSION_SECRET` | `openssl rand -base64 32` (at least 32 characters) |

Copy the site's **Project ID** from Project configuration → General → Project
information. That value is `NETLIFY_SITE_ID` on the build machine.

Create a personal access token (User settings → Applications) that can update
this site. That value is `NETLIFY_AUTH_TOKEN` on the build machine. It is not
a Netlify environment variable.

## 3. Hourly upload from the build machine

Response files stay on the machine, outside the repo. The contact bundle also
stays outside the repo. `--contacts` refuses a folder inside the repo.

```bash
export NETLIFY_AUTH_TOKEN="the personal access token"
export NETLIFY_SITE_ID="the project id"

python3 scripts/build-dashboard.py \
  --data-dir /path/to/response-files \
  --out /var/tmp/undash-private \
  --contacts

python3 scripts/publish-dashboard.py /var/tmp/undash-private
```

`publish-dashboard.py` writes the bundle into the site-wide blob store
`stall-dashboard` in region `us-east-2`, using:

`PUT https://api.netlify.com/api/v1/blobs/$NETLIFY_SITE_ID/site:stall-dashboard/<key>?region=us-east-2`

with `Authorization: Bearer $NETLIFY_AUTH_TOKEN` and
`Accept: application/json;type=signed-url`, then `PUT` of the file bytes to
the returned URL. It then deletes stored keys that this build no longer has
(yesterday's PDFs). The gate function opens the same store with
`getStore({ name: "stall-dashboard", region: "us-east-2" })`.

The counts-only refresh that is still committed can keep running **without**
`--contacts`. That command does not write contact PDFs, and it removes any
`sheets/*.pdf` left in its output folder.

## What the gate allows

- `POST /api/send` with `{ "who": "sudaththa" | "subraja" | "zainab" }` only. A phone number in the body is ignored.
- 3 texts per person and 8 per IP address, each per 15 minutes.
- 10 code checks per person per 15 minutes. Twilio's own limits still apply.
- `GET /view/…` only with a valid cookie. Anything else is redirected to the sign-in page and the file is not in the response.
