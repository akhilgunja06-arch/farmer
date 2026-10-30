# INTEGRATION_SETUP.md

Every external integration RythuDirect can use, what each one is for, the exact
environment variables it needs, and how to test it once configured.

The application runs without any of them. Each section states plainly what
stops working when the credentials are absent, so nothing is ever presented to a
user as working when it is not.

**Nothing in this document has been configured yet.** No keys were invented and
none were obtained. Every value below is a placeholder you fill in yourself.

---

## How to add a credential

1. Copy `.env.example` to `.env` in the repository root.
2. Fill in the values for the integration you want.
3. Restart the API. It prints a list of what is still missing on every start.
4. Confirm with `curl http://localhost:12001/api/health` — the `integrations`
   block reports `true` for each integration that is live.

Secrets belong in `.env`, which is git-ignored. Never put a secret in a
`VITE_`-prefixed variable: Vite inlines those into the browser bundle.

---

## A. Database and authentication

**Status: configured and working.** This is the only integration the application
cannot run without, and it is already provisioned locally.

| | |
|---|---|
| Purpose | PostgreSQL 17 stores all application data. Authentication is implemented in the API itself (`server/src/services/auth.ts`) against the `profiles` table. |
| Provider | PostgreSQL (local cluster, `127.0.0.1:5432`) |
| Required variables | `DATABASE_URL`, `APP_DATABASE_URL`, `JWT_SECRET` |
| Public or secret | All three are secret. `JWT_SECRET` signs session cookies. |
| Where configured | `.env` in the repository root |
| Billing | None |

Two database roles are used on purpose, and the application refuses to start if
they are the same role:

- `DATABASE_URL` — the schema owner (`rythu_app`). Migrations and seeding only.
  The running API never connects with it.
- `APP_DATABASE_URL` — the least-privilege runtime role (`rythu_web`), created
  with `NOBYPASSRLS`. Every request runs through it, so row level security
  always applies.

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"database":"[a-z]*"'
# expected: "database":"connected"
```

To confirm row level security is really enforced rather than assumed, connect as
the runtime role and count rows with no session set:

```bash
psql "$APP_DATABASE_URL" -tAc "SELECT count(*) FROM products"
```

Only active listings are returned. Rows the caller is not entitled to see are
filtered by the database, not by application code.

---

## B. Maps and location

**Status: not configured.** The location page works in list mode.

| | |
|---|---|
| Purpose | Interactive map of nearby farmers, place search, and distance-based discovery |
| Provider | [Google Maps Platform](https://developers.google.com/maps) |
| Required variable | `VITE_GOOGLE_MAPS_API_KEY` |
| Public or secret | **Public.** It is compiled into the browser bundle, so it must be restricted. |
| Where configured | `.env` in the repository root (Vite reads it at build/dev time) |
| Billing | Yes. A billing account and a card are required, even within the free tier. |

Enable only the APIs the application calls:

- **Maps JavaScript API** — the map itself
- **Places API** — address and place search
- **Geocoding API** — turning a farm address into coordinates
- **Distance Matrix API** — the "distance from you" figure on each listing

Restrict the key by HTTP referrer to your own origins, and restrict it to those
four APIs. A browser key is visible to anyone who opens developer tools.

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"maps":[a-z]*'
# expected: "maps":true
```

Then open `/locations` and confirm the map renders and the list stays in sync
with it.

**Without this credential:** `/locations` still supports selecting a state,
district and village, and shows matching farmers and crops as a list. The map
and the distance figure are hidden rather than shown broken.

---

## C. Payments

**Status: not configured.** Checkout offers cash on delivery only.

| | |
|---|---|
| Purpose | Online payment for orders |
| Provider | [Razorpay](https://razorpay.com) |
| Required variables | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Public or secret | `KEY_ID` is public. `KEY_SECRET` and `WEBHOOK_SECRET` are **secret** — server-side only. |
| Where configured | `.env` in the repository root |
| Billing | No monthly fee, but a merchant account and KYC (PAN, bank account, business proof) are required before live payments work. Test mode needs only a signup. |

The server creates the payment order, verifies the signature on the callback,
and confirms the webhook signature before recording anything. A payment is only
ever marked paid after that verification succeeds. The order's `payment_status`
is written by the server and cannot be set by a client.

Set the webhook in the Razorpay dashboard to point at:

```
https://<your-api-host>/api/webhooks/razorpay
```

Subscribe to at least `payment.captured` and `payment.failed`.

**How to test**

```bash
curl -s http://localhost:12001/api/payments/capability
# expected: "configured":true
```

A fabricated confirmation must be refused. This is asserted by the test suite:

```bash
npm test
# "PASS  a fabricated payment confirmation is refused"
# "PASS  order payment_status is 'unpaid', not falsely 'paid'"
```

**Without these credentials:** checkout shows an explicit "online payment is not
configured" state and offers cash on delivery where the farmer accepts it. No
payment is simulated and no money is claimed to have moved.

---

## D. Farmer advisor

  **Status: not configured.** The advisor page renders, but asking a question
  returns HTTP 503 with code `ADVISOR_NOT_CONFIGURED` rather than a fabricated
  answer.

  **Live completion is unverified.** No real provider call has been made from this
  repository, so the configured path - a successful model reply, its token usage,
  and the guard acting on real model output - has not been exercised end to end.
  Only the unconfigured path is covered by `scripts/e2e.sh`. Treat the integration
  as pending until a completion succeeds against a real key.

  | | |
  |---|---|
  | Purpose | Conversational crop guidance: which crop suits a farm, expected costs and yields, and weather-aware advice |
  | Provider | Any OpenAI-compatible chat-completions endpoint. The default is Groq (`https://api.groq.com/openai/v1`). |
  | Required variable | `GROQ_API_KEY` |
  | Optional variables | `GROQ_MODEL` (default `llama-3.3-70b-versatile`), `GROQ_BASE_URL`, `GROQ_MAX_TOKENS`, `GROQ_TEMPERATURE`, `GROQ_TIMEOUT_MS` |
  | Public or secret | **Secret.** Server-side only. Never expose it through a `VITE_` variable. |
  | Where configured | `.env` in the repository root |
  | Billing | Yes — the provider bills per token. `ask` is rate-limited more tightly than a read for this reason. |

  **Figures are enforced, not just requested.** The system prompt tells the model
  not to invent numbers, but a prompt is a request rather than a guarantee. Every
  reply is therefore passed through an output guard
  (`server/src/services/advisorGuard.ts`) before it is shown or stored. Any
  sentence stating a cost, yield, revenue, profit or duration that does not match a
  verified cell for the crop in context is withheld and replaced with a notice in
  the farmer's language. General advice - seasons, soils, irrigation, what a
  forecast implies - carries no such figure and passes through untouched.

  The guard's unit tests run without any credential:

  ```bash
  cd server && npm run test:guard
  # expected: Result: 61 passed, 0 failed
  ```

  **Cost and yield figures do not come from the model.** The advisor may only
  quote a figure that an administrator has recorded in `agronomic_reference`,
  and it cites that row's source and observation date. A crop with no recorded
  row is reported as "not available", never estimated. This is deliberate: a
  plausible but wrong cost per acre decides whether a family borrows money.

  **Recording figures.** An administrator enters them at
  `/admin/agronomic-reference`, or over the API. `source` is mandatory and a row
  with neither a cost nor a yield is refused. Only an administrator can write,
  and only an administrator can withdraw a figure.

  ```bash
  # As an administrator session cookie.
  curl -s -X POST http://localhost:12001/api/admin/agronomic-reference \
    -b "$ADMIN_COOKIE" -H 'Content-Type: application/json' -d '{
      "crop_name":"Cotton","state":"Telangana","district":"Warangal",
      "season":"kharif","cost_per_acre":42000,"yield_per_acre":8.5,
      "yield_unit":"quintal","duration_days":165,
      "source":"Telangana PJTSAU Package of Practices 2024",
      "observed_on":"2024-06-01"}'
  # expected: 201 {"id":1}
  ```

  Use a published state package of practices, a CACP cost-of-cultivation
  report, or a university extension bulletin. Do not enter an estimate.

  **How to test**

  ```bash
  curl -s http://localhost:12001/api/health | grep -o '"advisor":[a-z]*'
  # expected: "advisor":true
  ```

  **Without this credential:** the advisor page shows a notice that the advisor
  is not configured, and `ask` returns 503. Weather, the comparison table
  (where figures exist) and every other part of the application still work.

  **Weather is separate and keyless.** Open-Meteo needs no credential, so the
  weather panel works on any deployment. Responses are cached in
  `weather_snapshots`, keyed by coordinates rounded to about 1 km so farmers in
  one village share a single call.

  ---

## E. AI crop image assessment

**Status: not configured.** The feature is hidden.

| | |
|---|---|
| Purpose | Preliminary visual assessment of a crop photo |
| Provider | Any vision-capable model API. The request shape in `server/src/services/quality.ts` is OpenAI-compatible. |
| Required variables | `AI_VISION_ENABLED=true`, `AI_VISION_API_KEY`, `AI_VISION_MODEL` |
| Optional variable | `AI_VISION_BASE_URL` — an OpenAI-compatible endpoint. Leave blank to use `https://api.openai.com/v1`. |
| Public or secret | **Secret.** Server-side only. |
| Where configured | `.env` in the repository root |
| Billing | Yes — the provider bills per image analysed. |

**Scope limit, which the interface repeats to the user:** this can describe
visible characteristics such as discoloration, surface damage or uneven
appearance. It cannot establish chemical residue levels, pesticide safety,
microbial contamination, nutritional composition, laboratory grade, or food
safety certification. Those require laboratory testing.

Every AI result is labelled preliminary, is stored as `ai_assisted` rather than
any verified status, and is shown with:

> AI-assisted visual assessment is informational and does not replace
> professional inspection or laboratory testing.

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"aiVision":[a-z]*'
# expected: "aiVision":true
```

**Without these credentials:** the assessment button is not shown. Farmers can
still upload photographs, measurements and inspection documents manually.

---

## F. Email

**Status: not configured.** Messages are written to the server log instead.

| | |
|---|---|
| Purpose | Email verification, password reset, and order notifications |
| Provider | Any SMTP server — [Brevo](https://www.brevo.com), [SendGrid](https://sendgrid.com), [Postmark](https://postmarkapp.com), or your own |
| Required variables | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` |
| Public or secret | `SMTP_PASSWORD` is **secret**. The rest are configuration. |
| Where configured | `.env` in the repository root |
| Billing | Depends on the provider; most have a free tier for low volume. |

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"email":[a-z]*'
# expected: "email":true
```

Register an account and confirm the verification mail arrives. With no SMTP
configured, the message body including the link is printed to the server log
with an `[EMAIL:DISABLED]` prefix, which is enough to complete the flow
manually in development.

**Without these credentials:** no user-facing flow breaks. Verification and
reset links are logged for the operator instead of emailed, and the user is told
to contact support.

---

## G. SMS and phone OTP

**Status: not configured.** Phone OTP sign-in is hidden.

| | |
|---|---|
| Purpose | Phone OTP as an alternative sign-in, and SMS order updates |
| Provider | [MSG91](https://msg91.com), [Twilio](https://www.twilio.com), or another Indian SMS gateway |
| Required variables | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` |
| Public or secret | `SMS_API_KEY` is **secret**. |
| Where configured | `.env` in the repository root |
| Billing | Yes, per message. Indian promotional/transactional SMS also requires DLT registration of the sender ID and templates with TRAI. |

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"sms":[a-z]*'
# expected: "sms":true
```

**Without these credentials:** email and password sign-in works fully. The OTP
option is not displayed.

---

## H. Market price data

**Status: not configured.** Manual comparison is available.

| | |
|---|---|
| Purpose | Showing observed market prices beside a farmer's own price |
| Provider | Agmarknet / e-NAM |
| Required variables | `AGMARKNET_API_URL`, `AGMARKNET_API_KEY` |
| Public or secret | Depends on the access granted. Treat the key as secret. |
| Where configured | `.env` in the repository root |
| Billing | No fee, but **there is no open public REST API**. Access is granted case by case to registered institutions. |

Agmarknet publishes daily wholesale prices on its website but does not offer a
documented public API. It should not be assumed that programmatic access will be
granted; apply through the Directorate of Marketing & Inspection and use
whatever feed they approve. The application is built to ingest observations from
an approved source and store them in `market_price_observations` with a source
label and observation date.

**How to test**

```bash
curl -s http://localhost:12001/api/health | grep -o '"marketData":[a-z]*'
# expected: "marketData":true
```

**Without this credential:** `/farmer/market-insights` clearly labels all prices
as user-listed marketplace prices rather than official market rates, explains
that official data is not connected, and lets a farmer record their own
comparison observations manually. No price is ever invented, and no historical
observation is presented as current.

---

## I. Translation

**Status: not applicable — deliberately not an external integration.**

The interface is translated from a bundled dictionary in
`client/src/locales/` (`en.ts`, `te.ts`, `hi.ts`), covering English, Telugu and Hindi. This is a deliberate
choice: it works offline, adds no latency, costs nothing per request, and cannot
mis-translate a price or a quantity. Adding a machine-translation API would
introduce a per-request cost and a failure mode for no benefit at this scale.

The dictionary structure supports adding further Indian languages by adding one
file per language.

**Product descriptions are never machine-translated.** A farmer's own words are
shown as written, with a translated description only when one has been provided.

---

## Summary

| Integration | Variables | Status | Effect when absent |
|---|---|---|---|
| Database & auth | `DATABASE_URL`, `APP_DATABASE_URL`, `JWT_SECRET` | **Configured** | Application cannot start |
| Maps | `VITE_GOOGLE_MAPS_API_KEY` | Pending | List search instead of a map |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Pending | Cash on delivery only |
| Farmer advisor | `GROQ_API_KEY`, `GROQ_MODEL` | Pending | Advisor declines with 503; cost/yield figures need `agronomic_reference` rows |
| AI image assessment | `AI_VISION_ENABLED`, `AI_VISION_API_KEY`, `AI_VISION_MODEL`, `AI_VISION_BASE_URL` | Pending | Feature hidden |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Pending | Links logged to the console |
| SMS / OTP | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` | Pending | OTP sign-in hidden |
| Market prices | `AGMARKNET_API_URL`, `AGMARKNET_API_KEY` | Pending | Manual comparison only |
| Translation | none | Bundled | — |

The live state is always available at `GET /api/health`, which lists exactly
which integrations are configured and what each missing one affects.
