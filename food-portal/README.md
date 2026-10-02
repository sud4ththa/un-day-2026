# UN Day 2026 Food List Portal

Country leads submit the food plan for their stall. The PTC then uses those plans to build the parent forms.

UN Day is **Friday 16 October 2026**. Plans are due **Tuesday 6 October 2026**.

This folder is a separate site from the stall WhatsApp page at the root of the repository. GitHub Pages can keep serving that page. Netlify serves this portal.

In the portal, the Parent Collective is always called **the PTC**.

## What you need

- A free [Supabase](https://supabase.com) project (the database and the sign-in codes)
- A free [Netlify](https://www.netlify.com) site (the web page)
- The three admin email addresses for Sudaththa, Subraja, and Zainab

You do not need to install anything on your own computer if you follow the Supabase and Netlify steps below.

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and choose **New project**.
2. Pick a name and a database password. Save the password somewhere safe. Region can be the default.
3. Wait until the project status is healthy.

## 2. Create the tables

1. In the project, open **SQL Editor** (the left sidebar) and choose **New query**.
2. Open every file in `food-portal/supabase/migrations/`, in filename order. Copy each whole file into its own query and choose **Run**. The order is `20261001120000_init.sql`, then `20261001183000_bank_details.sql`, then `20261002120000_pledges.sql`, then `20261002180000_manage_leads.sql`, then `20261002210000_one_lead.sql`, then `20261003120000_ptc_enters_plans.sql`.

You should see a success message. The query creates the 12 stalls and last year’s dishes (Eco Warriors starts with none). It also turns on the access rules.

Run this file **once**. If you run it again, Postgres will say the tables already exist. That is fine: stop there.

## 3. Add the three admins

Nobody can sign in until their email is on the list. The first people have to be added with SQL, because the portal itself is locked until then.

1. Open `food-portal/supabase/seed_admins.sql`. The addresses are already filled in:
   - Subraja: `subraja.subramaniam@pta.britishschool.lk`
   - Zainab: `zainab.nuzhan@britishschool.lk`
   - Sudaththa: `sudaththa.ariyasena@pta.britishschool.lk`
2. Paste the file into a new SQL Editor query and choose **Run**. Change an address first only if that person uses a different email.

After that, those three people are admins. You do not add leads in SQL.

Stall leads and food coordinators do not sign in. Subraja talks to them and the PTC enters the plan. **Manage leads** keeps one **Lead** slot and an optional **Food coordinator** slot for each stall: name, email, and phone. Those addresses are used for the daily update email. They are not on the sign-in list. If a slot is already filled, saving a different email asks you to replace the current person. The admin overview and the CSV and JSON download show both names.

On **All stalls**, and again on **Manage leads**, each stall has a **Year group** dropdown: Nursery, Reception, then Year 1 through Year 11. Only an admin can set it. The lead sees it at the top of their plan, and it is included in the CSV and JSON download. Leads still cannot change it.

Emails are stored in lower case. `Name@School.org` and `name@school.org` are the same person.

## 4. Turn on the sign-in gate

The portal only creates a login for an email that is already on the list. Supabase checks that in the database, before it creates the user.

1. Open **Authentication → Hooks** (sometimes under **Auth Hooks**).
2. Find **Before user created**.
3. Choose the Postgres function `public.hook_before_user_created` and enable the hook.

Leave **sign-ups enabled** on the Email provider. The hook is what blocks strangers. If you turn sign-ups off, a new lead cannot receive a code.

Do not turn on CAPTCHA. The portal does not show a CAPTCHA box, so codes would stop arriving.

## 5. Send a 6-digit code, not a link

1. Open **Authentication → Providers → Email** (the screen may be called **Sign In / Providers**).
2. Turn the Email provider on.
3. Set the **OTP length** to **6**. If you do not see that field, look under **Authentication → Emails** or **Auth → Configuration**.
4. Open **Authentication → Emails → Templates** and edit the **Magic Link** template. Supabase uses that template for the code email. You can leave the Confirm signup template alone.

Set the subject to:

```text
Your UN Day food list code
```

Replace the message body with:

```html
<h2>UN Day 2026 food list</h2>
<p>Your sign-in code is</p>
<p style="font-size: 28px; letter-spacing: 6px; font-weight: bold;">{{ .Token }}</p>
<p>Enter this code in the food list portal. It expires in one hour.</p>
<p>If you did not ask for a code, you can ignore this email.</p>
<p>The British School in Colombo · Parent Collective</p>
```

`{{ .Token }}` is the 6-digit code. Do not remove it, and do not put `{{ .ConfirmationURL }}` in this template. The portal does not use a link.

WhatsApp codes through Twilio are not connected. Leave `VITE_OTP_PROVIDER` unset (or set it to `email`). Setting it to `whatsapp` only shows a notice on the sign-in page. It does not send a message. Parent phone numbers are stored and not verified. `VITE_PHONE_AUTH=twilio-verify` is reserved for a later Supabase phone check through Twilio Verify. Leaving it unset does not call Twilio.

5. Open **Authentication → URL Configuration**. Set **Site URL** to the Netlify address you get in step 8 (you can paste it after the first deploy). You do not need to add redirect URLs for the code.

## 6. The email limit, and how to raise it

Supabase’s built-in email service allows **2 emails per hour for the whole project**. That is not enough for a dozen leads. There is also a **60 second** wait before the same person can ask for another code.

Before the leads use the portal, connect your own email sender. [Resend](https://resend.com) has a free tier (100 emails a day, 3,000 a month), which is plenty here.

1. Create a Resend account.
2. Add a domain you control and enter the DNS records Resend shows you. Wait until it says verified.
3. Create an API key.
4. In Supabase, open **Authentication → Emails → SMTP Settings** and turn on custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the Resend API key
   - Sender email: an address on the verified domain, for example `food-list@yourdomain.org`
   - Sender name: `BSC Parent Collective`
5. Save.

Supabase then raises its own cap from 2 emails per hour to **30 per hour**. If you need more than 30 in one hour, open **Authentication → Rate Limits** and increase **Rate limit for sending emails**. Stay inside what Resend allows.

The address `onboarding@resend.dev` only delivers to the inbox that owns the Resend account. It will not reach the leads. Use a verified domain.

## 7. Try a sign-in before you involve the leads

1. Open **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key. You will paste both into Netlify.
3. Do **not** copy the `service_role` key into the website. That key bypasses the access rules.

Use one of the admin emails from step 3. After the site is deployed, ask for a code, type the 6 digits, and you should land on **All stalls**. From there, open **Manage leads** and add a lead: their name, email, phone if you have it, and stall.

An email that is not on the list should see: “This email is not on the list yet. Ask the PTC to add you.” No login is created for them.

## 8. Publish the site on Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repository.
2. Set **Base directory** to `food-portal`.
3. Netlify reads `food-portal/netlify.toml` for the rest:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Every address on the site opens the app (the SPA redirect).
4. Open **Site configuration → Environment variables** and add:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | the Project URL from Supabase |
   | `VITE_SUPABASE_ANON_KEY` | the anon public key |

5. Deploy the site. If you add the variables after the first build, deploy again. The values are copied in at build time, so a new build is required whenever they change.

The anon key is designed to be public. The database rules, not a secret key, decide what each person can see.

Give the PTC the Netlify address. Parents use the same site at `/pledge`. The GitHub Pages stall page is unchanged and stays on its own address.

## Try the demo

A static demo, with no sign-in and no database, is published with the stall page:

https://sud4ththa.github.io/un-day-2026/food-demo/

It goes live when the `food-demo/` folder is on the `main` branch. GitHub Pages deploys `main` from the repository root. The banner says “Demo: nothing is saved or sent.” Use **Try as** to open the admin list or the parent pledge. **Manage leads** and **Notifications** work the same way as the real portal, saved only in that browser. Notifications show a preview and never send. India, Europe, Sri Lanka, China, USA/Canada, Singapore/Malaysia/Thailand, Japan, and Middle East already have a year group. The other stalls are unset. Bank details stay closed until **Allow bank details** is turned on.

To rebuild it from this folder: `npm run build:demo`. That writes `food-demo/` at the repository root.

## How the PTC enters a plan

On **All stalls**, choose **Edit stall**. The PTC sets whether families contribute **food only**, **money only**, or **both**. For money they enter the amount per family, how to pay, and a deadline. If the stall is both, they say whether a family chooses one or must do both.

Dishes start from the 2025 list. An admin can add, remove, reorder, and edit them, including the per-dish cap. Each dish has a name, diet, allergens, spice, sweet or savoury, who makes it, a target number of pieces, and notes.

The page also asks for a food coordinator name and phone on the plan itself, the year group or groups, drop-off instructions, packaging (the starting text is “No single-use plastic.”), and a halal note. The sign-in contact for the daily email is separate, on **Manage leads**.

Changes save on their own, and there is a **Save** button. **Submit** marks the plan submitted. An admin can keep editing, and can lock the stall.

While they type, the page warns if the same or a similar dish is already on another stall, and it counts sweet dishes against savoury ones. **Preview the parent form** shows the wording parents would see.

Each dish has a **Target** and a **Limit**. The limit is the most parents can pledge. If the limit is blank, the target is the cap. **Published to parents** shows the plan on the pledge page. **Pledge deadline** is the last day a parent can add, change, or cancel a pledge. **Pledges** lists the parent’s name, dish, quantity, and phone. **Download pledges CSV** saves that list.

## How a parent pledges

Parents use a separate page, `/pledge`.

1. They enter an email, their child’s name, and the child’s class. Class is Nursery, Reception, or Year 1 to Year 11, plus a section letter if the class has one. They can add a second child.
2. They enter the 6-digit code from that email. Phone codes are offered only when `VITE_PHONE_AUTH=twilio-verify` is set. With no Twilio config, the page asks for email only.
3. The page opens the stall whose assigned year group matches the class. If that year has no stall, it says so and lists the stalls that still need food.
4. On one screen they choose dishes with a stepper, shown as “X of Y still needed”, or a money amount when the stall collects money.
5. A confirmation screen lets them edit or cancel. Coming back later uses the same code.

Bank details stay hidden while **Allow bank details** is off. Two parents cannot pledge more than the limit: the database checks the total and refuses the extra.

## How an admin uses the pledges

The admin list shows food pieces by stall and dish, money pledged by stall, and how many parents pledged. **Remove** soft-deletes a pledge and asks for a reason, such as Spam. The row stays in the database. **Download pledges CSV** includes every stall.

## How an admin uses it

Admins see every stall: not started, draft, submitted, or locked, with the last save time and who saved it. They can open a stall, lock or unlock it, and download **CSV** or **JSON**.

**Edit stall** opens that stall’s plan. The PTC can change dishes, caps, food or money, the lock, and the bank-details switch.

**Allow bank details** stays off until the PTC and the school approve collecting money into individual accounts. While it is off, the bank fields are visible but cannot be edited, and the parent form does not show them. The plan shows a warning if a note looks like it contains an account number. The CSV has one row per dish, with the stall summary on that row. A stall with no dishes still gets one summary row. The JSON lists each stall with its dishes inside.

**Dishes on more than one stall** collects the overlap in one place.

**Manage leads** stores the one lead and the optional food coordinator for each stall. They do not sign in. **Admins** on the same page adds or removes other PTC admins.

## Notifications

**Notifications** shows a preview of each message and a **Send test to me** button. Every send stays off until an admin turns that message on.

- Parent reminders go the day before the event, and again that morning, to parents who pledged. Email now. SMS later, through the same Twilio switch.
- A daily update goes to each stall’s lead and food coordinator: pledges so far, what is still needed, and what arrived since yesterday.
- A daily report goes to the PTC admins: every stall, totals and gaps, with a CSV.
- A progress note goes to addresses an admin types in. It is meant for Principal Mrs Hannah Wells and the rest of the Parent Collective. No addresses are filled in for you. The schedule is weekly, or every day if an admin chooses that.

The demo only shows the previews. Nothing is sent.

### Connect email

1. Create a [Resend](https://resend.com) API key and a from-address on a domain you control.
2. In the Supabase project, set secrets `RESEND_API_KEY`, `NOTIFY_FROM` (for example `UN Day <food@your-domain>`), and `NOTIFY_SECRET` (a long random string). `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to Edge Functions.
3. Deploy `food-portal/supabase/functions/send-notifications`.
4. On the site build, set `VITE_NOTIFY_URL` to `https://YOUR_PROJECT.supabase.co/functions/v1/send-notifications` and deploy again. **Send test to me** uses that address. If it is missing, the button says email is not connected and does not pretend to send.
5. Schedule the function once a day at 07:30 Colombo time (02:00 UTC). In the Supabase dashboard, add an Edge Function cron for `send-notifications` with body `{"mode":"scheduled"}` and header `x-notify-secret: YOUR_NOTIFY_SECRET`.

Or, if `pg_cron` and `pg_net` are enabled, run this in the SQL editor after you replace the project URL and the secret:

```sql
select cron.schedule(
  'un-day-food-notifications',
  '0 2 * * *',
  $$select net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', 'YOUR_NOTIFY_SECRET'
    ),
    body := '{"mode":"scheduled"}'::jsonb
  );$$
);
```

Parent reminders send only on the day before the event date and on the morning of that date. The daily stall update and the PTC report send when their switches are on. The progress note sends on Mondays when the schedule is weekly, and every day when an admin chooses every day. Turning a switch off stops that message. The local test database does not install `pg_cron`.

## How the lock works

Two checks run in the database, not only in the page:

1. **Before a login is created**, `hook_before_user_created` allows a PTC admin who is on the allowlist, and a parent who sends `purpose: parent`. A stall lead or food coordinator email is refused, including one that used to be on the allowlist. The migration `20261003120000_ptc_enters_plans.sql` copies those rows into `stall_contacts` and deletes them from the allowlist. A stranger who does not send the parent purpose is still refused.
2. **On every read and write**, row-level security checks the allowlist again. Only a PTC admin can edit stalls, dishes, contacts, and notification switches. Parents can read a stall only after it is published, and they can read only their own pledges. Remaining counts come from a separate call that does not include other parents’ names. An admin sees every pledge. The quantity cap is checked in the database, including when two parents save at the same time.

Locking a stall is also enforced there. An admin can still edit a locked plan. A former lead login cannot.

A technical helper can re-check that on a local Postgres with:

```bash
cd food-portal/supabase
./tests/run_rls_test.sh
```

The script prints `ALL RLS CHECKS PASSED` when a stall contact cannot read or write a plan. It does not touch the Supabase project. `tests/harness.sql` is only for that local check. Do not paste it into the Supabase SQL editor.

## If something goes wrong

- **“This portal is not connected to Supabase yet.”** The Netlify variables are missing or the site was not rebuilt after you added them.
- **“This email is not on the list yet.”** Add them as a lead (or fix the admin snippet) and try again.
- **The code never arrives.** You are probably still on the built-in limit of 2 emails an hour, or the Resend domain is not verified. Check **Authentication → Logs** in Supabase.
- **“Too many codes were sent.”** Wait a few minutes. The same person can ask again after 60 seconds, and the project has an hourly cap.
- **The code is rejected.** Confirm the OTP length is 6, and that the template still contains `{{ .Token }}`.
- **A lead sees an empty page or “could not be opened”.** Their list entry has no stall, or the stall name was changed in SQL. Assign the stall again from **Manage leads**.
- **SQL says “already exists”.** The migration has already been run. Do not drop tables unless you mean to erase the plans.
