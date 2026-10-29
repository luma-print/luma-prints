# Luma Prints – photo printing website

Two versions are included:
- **Full site (Node, root folder)** – uploads, online payment (Stripe), admin page for orders + contact messages.
- **Static site (`static-site/`)** – pure HTML/CSS (+ a little JS for the price list), publish free on Netlify; forms handled by Netlify Forms.

## Prices – edit in ONE place
`public/prices.js` (copy it to `static-site/prices.js` too if you use the static version). Standard prints have all 21 sizes; glossy = same price as standard (free finish option, matte/standard vs glossy). Canvas is not offered. (If you ever set a price to `null` it shows as [SET PRICE] and orders for it become price-to-be-confirmed inquiries.)

## Placeholders to replace (search for `[ADD` and `[OWNER`)
`[ADD BUSINESS ADDRESS]`, `[ADD PHONE]`, `[ADD EMAIL]`, `[ADD HOURS]` (footer + contact page), About Us text, gallery images in `public/img/` (currently free placeholder photos from picsum.photos — replace with your own work).

## Publish the static version (no server)
**Netlify (recommended – forms work automatically):** log in at app.netlify.com → *Add new site → Deploy manually* → drag the `static-site` folder in. Order inquiries (with up to 5 photo files) and contact messages appear under *Site → Forms*; turn on email notifications there. Netlify limits: 8 MB total upload per submission, 30 s timeout, free tier 100 submissions/month.
**GitHub Pages:** works for pages, but forms need a backend — use Netlify, or point the forms' `action` to a service like Formspree.
The static version doesn't take online payment; you confirm and invoice by email.

Customers upload photos, choose size (4×6 $0.69 · 8×10 $4.00 · 16×20 $18.00) and quantity per photo, enter contact + pickup/shipping, and pay with Stripe Checkout. You receive every order (files + details) in a password-protected admin page, plus optional email alerts.

## Run locally
```bash
npm install
cp .env.example .env   # edit values, then export them (or use your host's env settings)
npm start              # http://localhost:3000   admin: http://localhost:3000/admin
```
Node 18+. Without `STRIPE_SECRET_KEY` the site runs in **demo mode**: orders are saved and marked **"unpaid - payment pending (demo mode)"**, and customers see a banner saying so.

## Environment variables
| Var | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | **yes** (no default – /admin is disabled until set) | Password for /admin (any username). If unset, read from the Render secret file `/etc/secrets/admin_password` (trimmed) |
| `BREVO_API_KEY` | recommended on Render | Sends all emails via Brevo's HTTPS API (Render's free plan blocks SMTP). When set, SMTP is not used |
| `BASE_URL` | yes in production | Public URL, used for Stripe return links |
| `STRIPE_SECRET_KEY` | to take payments | `sk_test_…` for testing, `sk_live_…` to go live |
| `SHIPPING_FEE` | no (default 5.00, placeholder) | Flat shipping fee |
| `DATA_DIR` | recommended in prod | Folder for orders/uploads (point at a persistent disk) |
| `OWNER_EMAIL` | no (default `Luma.prints1@gmail.com`) | Where order + contact emails go |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | to send email | See *Email setup* below. SMTP fallback, used only if `BREVO_API_KEY` is unset. Neither set = no emails (orders still saved) |
| `MAX_ATTACH_MB` | no (default 10) | Max photos attached per order email; extra photos become admin download links |

## Where orders go
- `data/orders/<ORDER-ID>.json` – customer, delivery, items, totals, payment + status
- `data/uploads/` – the original photo files
- `data/messages/` – contact form messages (also shown in /admin)
- `/admin` – list of orders + contact messages, file download links, status (new → printing → ready → shipped → completed) and a "paid" toggle (useful for cash/demo orders).

Payment is confirmed when Stripe redirects the customer back (`/api/stripe/return`). Always double-check in your Stripe Dashboard before printing.

## Deploy
**Render:** New → Web Service → connect repo. Build `npm install`, start `npm start`. Add env vars above. Add a **Persistent Disk** (e.g. mount `/var/data`) and set `DATA_DIR=/var/data` — otherwise uploads are lost on redeploy.
**Railway:** New Project → Deploy from GitHub. Add the env vars, add a **Volume** mounted at e.g. `/data`, set `DATA_DIR=/data`. Set `BASE_URL` to the generated domain.

## Before going live – fill in
- Stripe account → Developers → API keys → secret key into `STRIPE_SECRET_KEY`.
- Footer placeholders in `public/*.html`: `[ADD BUSINESS ADDRESS]`, `[ADD PHONE]`, `[ADD EMAIL]`.
- Your real shipping fee, and a strong `ADMIN_PASSWORD`.

## Email setup (Gmail) – full Node site
Every order emails **Luma.prints1@gmail.com** with: customer name/email/phone, each photo's size, finish and quantity, totals, pickup or shipping address, and the **photo files attached** (up to `MAX_ATTACH_MB`, default 10 MB — Brevo caps a message at ~20 MB encoded; any photos that don't fit are listed as password-protected `/admin` download links). Reply-to is set to the customer. The customer gets a confirmation email; with Stripe you also get a short "PAID" email after payment. Contact-form messages are emailed to the same address.

### Brevo (recommended; required on Render free plan)
Render's free plan blocks outbound SMTP, so use Brevo's HTTPS API:
1. Create a free account at brevo.com, then **Senders, Domains & Dedicated IPs → Senders** and add/verify `Luma.prints1@gmail.com` as a sender.
2. **SMTP & API → API Keys → Generate a new API key**.
3. In Render → your service → **Environment**, add `BREVO_API_KEY=<key>` (and optionally `SMTP_FROM=Luma.prints1@gmail.com`), save, and let it redeploy.
Failures are logged as `Email failed: Brevo <status>: <error body>` in Render's logs.

1. Sign in to Luma.prints1@gmail.com → https://myaccount.google.com/security → turn on **2-Step Verification** (required for app passwords).
2. Go to https://myaccount.google.com/apppasswords → name it "Luma Prints website" → **Create** → copy the 16-character password.
3. On your host (Render/Railway → Environment), set:
   `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=Luma.prints1@gmail.com`, `SMTP_PASS=<the app password, no spaces>`, `SMTP_FROM=Luma.prints1@gmail.com`
4. Redeploy and place a test order. If nothing arrives, check the server logs for `Email failed:`.
Note: Gmail allows ~500 emails/day from a personal account — plenty for a small shop.

## Email notifications – static Netlify site
Netlify site → **Site configuration → Forms → Form notifications → Add notification → Email notification** → event "New form submission", form **Any form** (or add one each for `order` and `contact`) → email **Luma.prints1@gmail.com** → Save. Each email contains all form fields; uploaded photos appear as **download links** (not attachments). Submissions also stay under *Forms* in the Netlify dashboard. Also enable *Forms → Form detection* if it is off.

## Deploy on Render (render.yaml included)
Render dashboard → **New → Blueprint** (or Web Service) → paste this public repo URL → it reads `render.yaml`. Fill in the secret values when prompted (`ADMIN_PASSWORD`, `BREVO_API_KEY`, optional `STRIPE_SECRET_KEY`), then set `BASE_URL` to the `https://….onrender.com` URL Render gives you and redeploy.
**Free plan caveat:** free web services have no persistent disk and sleep when idle — uploaded photos/orders stored on the server are wiped on each redeploy/restart. Orders are still emailed to you with photos attached, so the email is your record. For permanent storage upgrade to a paid instance with a Disk mounted at e.g. `/var/data` and set `DATA_DIR=/var/data`.
