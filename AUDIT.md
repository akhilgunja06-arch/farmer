# RythuDirect — API and Integration Audit

Date: 2026-10-26
Scope: the source in this repository (`server/`, `client/`, `server/src/db/migrations/`).
Method: static reading of the source plus live probes against the running API on
`http://127.0.0.1:12001`. Every claim below is backed by either a file/line
reference or a recorded HTTP response. Nothing here is inferred from the
documentation, and no credential value was read or printed.

## What is running

| Component | Detail |
|---|---|
| API | Express 4 on port 12001, TypeScript, ESM |
| Client | React 19 + Vite + Tailwind 4 on port 12000, `/api` proxied to the API |
| Database | PostgreSQL 17, database `rythudirect`, 28 relations, 4 migrations applied |
| Runtime DB role | `rythu_web` (NOBYPASSRLS) — every HTTP request |
| Owner DB role | `rythu_app` — migrations and seed only |

---

## 1. External integration audit

Each integration is reported with the seven required fields. "Free tier" figures
were read from the providers' own pricing pages on the audit date.

### A. PostgreSQL — database

| Field | Value |
|---|---|
| 1. Integration / provider | PostgreSQL 17 (self-hosted, local cluster) |
| 2. Exact feature using it | Every table in the application. Authentication is implemented in-process (`server/src/services/auth.ts`) against `profiles`; there is no external auth provider. |
| 3. Official provider website | https://www.postgresql.org |
| 4. Required API / service | A reachable PostgreSQL 17 server and two login roles |
| 5. Exact credential / env var | `DATABASE_URL` (owner), `APP_DATABASE_URL` (runtime), `JWT_SECRET` |
| 6. Public or private | All private. `JWT_SECRET` signs session cookies; both connection strings contain passwords. |
| 7. Free tier / paid / pricing | Not applicable — you host it. Cost is infrastructure only. |

**Status: configured and working.** Verified: `/api/health` returns
`"database":"connected"`. `config.ts` throws at startup if the two connection
strings are the same role, which is what keeps RLS from being silently bypassed.

### B. Google Maps Platform — location discovery

| Field | Value |
|---|---|
| 1. Integration / provider | Google Maps Platform |
| 2. Exact feature using it | Location discovery at `/locations`. **This is the only consumer.** |
| 3. Official provider website | https://developers.google.com/maps |
| 4. Required API / service | Declared: Maps JavaScript API, Places API, Geocoding API, Distance Matrix API. Actually needed by the current code: none — see below. |
| 5. Exact credential / env var | `VITE_GOOGLE_MAPS_API_KEY` |
| 6. Public or private | **Public.** Vite inlines it into the browser bundle. It must be restricted by HTTP referrer. |
| 7. Free tier / paid / pricing | Free cap of **10,000 billable events per SKU per month**; beyond that, per-1,000-event pricing by SKU (e.g. Autocomplete $2.83 / 1,000). A billing account with a card is required even inside the free tier. Source: https://developers.google.com/maps/billing-and-pricing/pricing |

**Status: not configured, and the feature is not implemented.**

Two independent problems:

1. **The key would not reach the browser.** `client/vite.config.ts` has no
   `envDir`, so Vite reads `client/.env`, not the repository-root `.env` where
   `INTEGRATION_SETUP.md` and `.env.example` tell you to put the key. Verified
   empirically: a probe variable added to the root `.env` did **not** appear in
   a production `vite build` output. Setting the variable as documented changes
   nothing.
2. **No map is ever rendered.** `LocationsPage.tsx` reads the key and, when it is
   present, renders a `<div>` containing a `MapPin` icon and a text list of
   farmer names. There is no Google Maps loader, no `google.maps.Map`, no
   marker, and no Places/Geocoding/Distance Matrix call anywhere in the client
   (verified: zero matches for `maps.googleapis`, `google.maps`, `@googlemaps`
   in `client/`; the package is not a dependency). So even with the key present
   and correctly loaded, the page shows a placeholder, not a map.

**What the application does instead (and does work):** `/api/dashboard/nearby-farmers`
computes Haversine distance over consented coordinates in SQL, so distance-based
discovery works with no mapping provider. The list view at `/locations` is
functional. What is missing is only the visual map.

**If you want the map:** fix `envDir` (or document `client/.env`), then add a
loader plus a real map component. Restrict the browser key by referrer and to
only the APIs you actually call. Enable only the APIs used.

### C. Razorpay — payments

| Field | Value |
|---|---|
| 1. Integration / provider | Razorpay |
| 2. Exact feature using it | Order payment. Server-side order creation (`POST https://api.razorpay.com/v1/orders`), callback signature verification, webhook verification, refunds (`POST /v1/payments/{id}/refund`). |
| 3. Official provider website | https://razorpay.com |
| 4. Required API / service | Razorpay Payments API, Basic auth with key id + key secret; a dashboard webhook subscribed to at least `payment.captured` and `payment.failed` |
| 5. Exact credential / env var | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| 6. Public or private | `RAZORPAY_KEY_ID` is public (it is sent to the browser at checkout). `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are **private, server-side only**. |
| 7. Free tier / paid / pricing | No setup fee and no annual maintenance charge. Per-transaction only: standard domestic card rate is **2% + GST** (the `razorpay.com/in/pricing` page also shows a promotional 0%-for-90-days startup offer). A merchant account with KYC (PAN, bank account, business proof) is required before live payments. Test mode needs only a signup. Source: https://razorpay.com/in/pricing/ |

**Status: not configured, and checkout does not call it even when configured.**

Server-side work is genuinely complete and correct: the secret never leaves
`services/payments.ts`, amounts are converted to paise (`Math.round(amount * 100)`),
the webhook router is mounted *before* `express.json()` so the raw body survives
for HMAC verification, and `POST /api/payments/confirm` recomputes the HMAC
server-side rather than trusting the client.

The gap is the browser side. `client/src/lib/services.ts` defines
`payments.initiate(...)` and `payments.confirm(...)`, but nothing calls them.
`CustomerCheckout.tsx` only calls `payments.capability()` and then displays a
notice; `placeOrder()` calls `ordersApi.checkout()` and navigates to
`/customer/orders`. There is no Razorpay Checkout script and no `new Razorpay(...)`
anywhere in the client. So:

- With credentials set, `capability.configured` becomes `true` and the checkout
  page shows a green "pay online" notice — but there is still no way to pay
  online. The notice would be misleading.
- The order is always created with `payment_status = 'unpaid'` (the column
  default). That is honest, but nothing moves it to `paid` except a webhook or a
  `confirm` call that no code makes.

**Verified good:** a fabricated confirmation is refused (signature mismatch), and
no path marks an order paid without server-side verification. The money-handling
*logic* is sound; it is the UI wiring that is missing.

### D. AI crop image assessment

| Field | Value |
|---|---|
| 1. Integration / provider | Any OpenAI-compatible chat-completions endpoint. The code targets **OpenAI** specifically: `https://api.openai.com/v1/chat/completions`. |
| 2. Exact feature using it | `POST /api/quality/ai-assess` → `services/quality.ts#callVisionModel`. Produces a preliminary "visible characteristics" assessment stored in `crop_quality_reports`. |
| 3. Official provider website | https://platform.openai.com |
| 4. Required API / service | Chat Completions API with a vision-capable model and JSON response format |
| 5. Exact credential / env var | `AI_VISION_API_KEY`, `AI_VISION_MODEL` (default `gpt-4o-mini`), `AI_VISION_ENABLED` |
| 6. Public or private | **Private.** Server-side only. |
| 7. Free tier / paid / pricing | No free tier. Pay-per-token; the configured default `gpt-4o-mini` is a low-cost vision-capable model billed per input/output token, with image input billed as tokens. Source: https://platform.openai.com/docs/pricing |

**Status: not configured, and the feature is unreachable even when configured.**

The prompt engineering here is careful and correct: the system prompt forbids
commenting on pesticide residue, chemical contamination, microbial safety,
nutrition or certification, and the response is filtered so such a claim cannot
be stored. Results are stored as `ai_assisted`, never as a verified status, and
the disclaimer is returned with every result. This meets the brief's safety
requirement.

Three defects block it:

1. **The client calls a route that does not exist.** `quality.aiStatus()` does
   `GET /api/quality/ai-assess`; only a `POST` is registered. Verified: `404
   NOT_FOUND`. It should call the capability flag from `/api/health` or
   `/api/admin/settings`.
2. **`quality.aiAssess(file)` cannot work.** It sends `multipart/form-data` with
   an `image` field, but the route expects JSON `{product_id, image_path}` and
   `multer` is not applied to `/api/quality`. Verified: the multipart request
   returns `400 MISSING_FIELDS`.
3. **The image would not be readable by the model anyway.** `callVisionModel`
   passes the stored storage key straight through as
   `image_url: { url: imagePath }`. No data-URI conversion and no signed URL is
   built anywhere. A bare relative path such as `products/abc/photo.jpg` is not
   a URL the provider can fetch, so the call would fail even with a valid key.

Also `quality.myIssues()` calls `GET /api/quality/issues/mine`, which does not
exist (verified `404`). The equivalent endpoint is `GET /api/reports/mine`.

**Side effect on a public page:** because `aiStatus` 404s, `aiStatus.data` stays
`undefined`, so `/quality-standards` permanently displays "Not configured" for
AI-assisted assessment regardless of the real configuration. If the feature were
enabled, that public page would still say it was not.

### E. Email (SMTP) — transactional email

| Field | Value |
|---|---|
| 1. Integration / provider | Any SMTP server. `nodemailer@^6.9.16` is the client. No provider is hardcoded; `INTEGRATION_SETUP.md` suggests Brevo, SendGrid or Postmark. |
| 2. Exact feature using it | `services/email.ts` — email-verification links, password-reset links, and order notifications. |
| 3. Official provider website | Provider-dependent; e.g. https://www.brevo.com, https://sendgrid.com, https://postmarkapp.com |
| 4. Required API / service | An SMTP relay reachable from the API host |
| 5. Exact credential / env var | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` |
| 6. Public or private | `SMTP_PASSWORD` is **private**. The rest are ordinary configuration. |
| 7. Free tier / paid / pricing | Provider-dependent. Most offer a free tier at low volume (SendGrid 100 emails/day, Brevo 300/day, Postmark a trial); beyond that it is per-1,000-email pricing. |

**Status: not configured. The fallback is correct.** With no SMTP host,
`capabilities.email` is `false` and messages are written to the server log with
an `[EMAIL:DISABLED]` prefix, so verification and reset remain completable
manually. No user-facing flow breaks and no email is faked.

### F. SMS / phone OTP

| Field | Value |
|---|---|
| 1. Integration / provider | None implemented. Documented candidates: MSG91, Twilio, or another Indian gateway. |
| 2. Exact feature using it | **No feature uses it.** See below. |
| 3. Official provider website | https://msg91.com, https://www.twilio.com |
| 4. Required API / service | An SMS gateway API and, in India, a TRAI DLT-registered sender ID and templates |
| 5. Exact credential / env var | `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID` |
| 6. Public or private | `SMS_API_KEY` is **private**. |
| 7. Free tier / paid / pricing | Per message; Indian transactional SMS additionally requires DLT registration of the sender ID and every template. |

**Status: declaration only — there is no implementation.**

`capabilities.sms` is `Boolean(config.sms.provider && config.sms.apiKey)`, and the
only other reference to `config.sms` in the entire server is the human-readable
description string in `services/market.ts`. There is no SMS client, no send
function, and no OTP route. Verified: the only outbound HTTP calls in the whole
server are Razorpay (order, refund) and OpenAI (vision) — three `fetch` sites.

Consequence: setting `SMS_PROVIDER` and `SMS_API_KEY` flips
`/api/health` → `"sms":true` and changes a status message, but enables no
behaviour. **This is a status flag that can report a capability that does not
exist.** Either implement the OTP flow or remove the flag; leaving it invites a
false impression that phone OTP is available.

### G. Market price data (Agmarknet / e-NAM)

| Field | Value |
|---|---|
| 1. Integration / provider | Agmarknet (Directorate of Marketing & Inspection) / e-NAM |
| 2. Exact feature using it | `/farmer/market-insights`, `market_price_observations` |
| 3. Official provider website | https://agmarknet.gov.in (also https://www.enam.gov.in) |
| 4. Required API / service | **There is no documented public REST API.** Access is granted case by case. |
| 5. Exact credential / env var | `AGMARKNET_API_URL`, `AGMARKNET_API_KEY` |
| 6. Public or private | Would be **private** if granted. |
| 7. Free tier / paid / pricing | No fee is published; there is no self-serve tier. Programmatic access is by arrangement. |

**Status: not configured, and unimplemented — but this one is correctly handled.**

`AGMARKNET_API_URL`/`AGMARKNET_API_KEY` are read into `config.agmarknet` and used
only for the `capabilities.marketData` flag and its description string. There is
no fetch. Unlike SMS, the behaviour is honest and the brief's requirement is met:
`/farmer/market-insights` labels all prices as **user-listed marketplace prices**
rather than official market rates, states that official data is not connected,
and offers manual entry (`POST /api/market/observations`) plus a manual
comparison view (`GET /api/market/compare`). The `market_price_observations`
table stores a `source` label and observation date, so an approved feed could be
ingested later without a schema change.

The honest framing is the right call: no price is invented and no historical
observation is presented as current.

### H. Translation

| Field | Value |
|---|---|
| 1. Integration / provider | **None — deliberately not an integration.** |
| 2. Exact feature using it | The whole UI, via bundled dictionaries in `client/src/locales/` (`en.ts`, `te.ts`, `hi.ts`) and `react-i18next`. |
| 3. Official provider website | Not applicable |
| 4. Required API / service | Not applicable |
| 5. Exact credential / env var | None |
| 6. Public or private | Not applicable |
| 7. Free tier / paid / pricing | Free. No per-request cost, works offline. |

**Status: complete.** English, Telugu and Hindi are all present, with a Noto font
stack loaded in `index.html` for Devanagari and Telugu script coverage. Adding a
language is one file. Product descriptions are shown as the farmer wrote them and
are never machine-translated — which also means translation can never alter a
listed price.

---

## 2. API surface — client/server contract

116 server routes were extracted and compared against 106 client call sites.

### Broken contract (client calls a route the server does not serve)

| Client call | Actual server route | Live result |
|---|---|---|
| `GET /api/farmers/nearby-farmers` | `GET /api/dashboard/nearby-farmers` | `400 INVALID_INPUT` |
| `GET /api/quality/ai-assess` | (none; only `POST`) | `404 NOT_FOUND` |
| `GET /api/quality/issues/mine` | `GET /api/reports/mine` | `404 NOT_FOUND` |

The nearby-farmers case also mismatches the query contract. The client sends
`near_lat`/`near_lng`/`max_distance_km` (the *products* schema names) while the
dashboard route reads `lat`/`lng`/`radius_km`. Because `/api/farmers/:id` is
registered before `/nearby-farmers` would be, the request falls into the
single-farmer handler, the literal string `nearby-farmers` fails the UUID cast,
and PostgreSQL error `22P02` is mapped to `400 INVALID_INPUT`. Verified live on
both paths.

**Impact:** the "Nearby Farmers" location search cannot return distance-sorted
results, and the AI-assessment status and issue-history calls always fail. The
`/locations` page degrades to an unsorted directory; it does not crash.

### Routes present but not reachable from the UI

- `POST /api/farmer/profile/verification-request` — the farmer verification
  request. Both buttons labelled "Request verification"
  (`FarmerDashboard.tsx`, `FarmerQualityReports.tsx`) are `navigate('/farmer/profile')`
  or report-review actions; neither posts a request. `farmers.requestVerification`
  exists in `services.ts` with no caller. So a farmer can reach
  `/farmer/profile`, see the verification card, and find no way to apply.
- `POST /api/farmer/profile/verification-documents` — no UI.
- `POST /api/payments/refund` — admin-only and correct, but `AdminOrders.tsx`
  only lists `refunded` as a status option; no refund button calls it.
- `GET /api/orders/:id/payments` — no UI.
- `GET /api/files/:ownerId/:scope/:filename` — reached via `<img src>` rather
  than the API client, so its absence from the call list is expected.

### Client-call count note

106 client call sites resolve to 3 genuinely missing routes. The remaining
difference is accounted for by routes reached outside the `api.*` helper
(`files`), by path parameters, and by server-only endpoints (the Razorpay
webhook).

---

## 3. Authorization — empirical matrix

Obtained by logging in as one account per role and recording the HTTP status of
each endpoint. `CUST` = customer, `FARM` = farmer, `ADMIN` = administrator.

| Endpoint | ANON | CUST | FARM | ADMIN |
|---|---|---|---|---|
| `/api/products`, `/api/farmers`, `/api/quality/standards` | 200 | 200 | 200 | 200 |
| `/api/cart`, `/api/saved`, `/api/addresses`, `/api/reviews/mine` | 401 | 200 | 403 | 403 |
| `/api/dashboard/customer` | 401 | 200 | 403 | 403 |
| `/api/dashboard/farmer`, `/api/farmer/profile`, `/api/products/mine` | 401 | 403 | 200 | 403 |
| `/api/orders`, `/api/messages`, `/api/notifications` | 401 | 200 | 200 | 200 |
| `/api/admin/*`, `/api/market/integration-status` | 401 | 403 | 403 | 200 |

Every boundary behaves as intended. Enforcement is at the router level via
`requireSession` + `requireRole(...)`, not by hiding UI: a customer calling
`POST /api/products` gets `403 FORBIDDEN_ROLE`, and an anonymous caller gets
`401`.

### Cross-tenant isolation

Tested with two separate farmer accounts and a product owned by the first:

- Farmer B `PATCH` farmer A's product → `404 PRODUCT_NOT_FOUND`
- Farmer B `DELETE` farmer A's product → `404 PRODUCT_NOT_FOUND`
- Customer `PATCH` any product → `403 FORBIDDEN_ROLE`

Returning 404 rather than 403 for the non-owner farmer is the better choice: it
does not confirm that the row exists.

### Row Level Security — verified at the database, not just in the app

Connecting directly as the runtime role `rythu_web` with no session context set:

| Query | Result |
|---|---|
| `SELECT count(*) FROM products` | 11 (table total 11 — all listings currently active/public) |
| `SELECT count(*) FROM customer_addresses` | 0 (table total 2) |

Private address rows are invisible to the runtime role without an identity, which
proves RLS is enforced by the database rather than by application filters. A role
escalation attempt was also refused:

```
UPDATE profiles SET role='admin' WHERE email='...'  →  UPDATE 0
```

The runtime role cannot promote itself. `config.ts` additionally refuses to start
if `DATABASE_URL` and `APP_DATABASE_URL` name the same role.

---

## 4. Security review

**Passing**

- No hardcoded credentials. A scan for secret-shaped literals across
  `server/src` and `client/src` returned nothing; no `rzp_`, `sk_`, `ghp_` or
  `AIza…` patterns exist in source.
- No server secret in the client bundle. Built `client/dist` was scanned for the
  live values of `JWT_SECRET`, `DATABASE_URL` and `APP_DATABASE_URL` — none present.
- Passwords are hashed (`bcryptjs`); `profiles` holds no password column.
- Session cookies are HTTP-only, `SameSite`, and signed with `JWT_SECRET`;
  CORS uses an explicit origin allow-list with credentials rather than a wildcard.
- Helmet, rate limiting (`express-rate-limit`), `trust proxy` for correct
  per-client buckets, and a 1 MB JSON cap plus a 50 MB multipart backstop.
- Financial columns are `NUMERIC`; the pg NUMERIC parser is overridden to avoid
  float precision loss, and DATE is parsed to a plain string so harvest dates
  cannot drift across timezones.
- The webhook route is mounted before the body parser specifically so the raw
  body remains available for signature verification.
- The order checkout accepts an `idempotency_key`, which is the right guard
  against a double tap creating two orders.

**Observations**

| Severity | Finding |
|---|---|
| Medium | SMS capability can report `true` with no implementation (section F). A status endpoint that overstates readiness is a trust problem. |
| Medium | `VITE_GOOGLE_MAPS_API_KEY` cannot reach the browser from the root `.env` as documented, because `client/vite.config.ts` sets no `envDir`. Anything following the setup doc would conclude "configured" while nothing changes. |
| Low | `.env` is mode `664`. The repository default umask already makes it group-readable. Consider `600`. |
| Low | `server/storage/` is world-readable (`drwxrwsr-x`) and files are served through `GET /api/files/...`, which does enforce session auth in code — but the directory perms mean anyone with filesystem access can read all uploads regardless. |
| Info | `helmet` CSP is disabled globally (`contentSecurityPolicy: false`) and set per-response where it matters. Reasonable for an SPA, but worth confirming the per-response policy covers every HTML response. |

**No finding** in the areas the brief flagged as high-risk: no mock
authentication, no client-settable payment status, no localStorage-as-database,
no plain-text passwords, no secret in the bundle.

---

## 5. Data model and migrations

- 4 migrations applied and recorded in `schema_migrations`, each with a checksum:
  `0001_core_schema.sql`, `0002_business_rules.sql`, `0003_rls_and_views.sql`,
  `0004_verification_status_expired.sql`. The schema is reproducible from scratch.
- 28 relations, all owned by `rythu_app`; RLS enabled on every application table
  (only `schema_migrations` is exempt, which is correct).
- 5 security-barrier-style public views — `public_profiles`,
  `public_farmer_profiles`, `public_products`, `public_product_images`,
  `public_quality_reports`, `public_reviews` — so anonymous reads go through a
  curated projection rather than raw tables. This is why the runtime role sees
  only public rows with no session set.
- Every entity the brief listed is present, plus `auth_tokens`,
  `payment_events`, `seller_ledger`, `user_blocks` and `saved_products`.
- Order status enum matches the brief exactly: `pending_confirmation`,
  `accepted`, `preparing`, `ready_for_pickup`, `shipped`, `delivered`,
  `cancelled`, `refund_pending`, `refunded`.
- `seller_ledger` exists, so the multi-seller split required by the brief is
  modelled in the schema.

---

## 6. Findings summary

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | High | `GET /api/farmers/nearby-farmers` — wrong path and wrong query params; always `400`. Distance search unusable. | `client/src/lib/services.ts:123`, `server/src/routes/farmers.ts:481` |
| 2 | High | `GET /api/quality/ai-assess` does not exist; `aiStatus` always `404`. Also makes `/quality-standards` permanently display "Not configured". | `client/src/lib/services.ts:305`, `pages/public/QualityStandardsPage.tsx:160` |
| 3 | High | `quality.aiAssess()` sends multipart to a JSON route; cannot succeed. | `client/src/lib/services.ts:307`, `server/src/routes/reviews.ts:217` |
| 4 | High | AI vision passes a bare storage key as `image_url`; no data URI or signed URL is ever built. | `server/src/services/quality.ts:273` |
| 5 | Medium | No Razorpay Checkout in the browser and nothing calls `payments.initiate`; with credentials set, checkout shows a "pay online" notice but offers no way to pay. | `client/src/pages/customer/CustomerCheckout.tsx:203` |
| 6 | Medium | `VITE_GOOGLE_MAPS_API_KEY` cannot reach the browser from the root `.env` — Vite reads `client/.env`. | `client/vite.config.ts` |
| 7 | Medium | No map is implemented even with a key; `LocationsPage` renders a placeholder. | `client/src/pages/public/LocationsPage.tsx:122` |
| 8 | Medium | `SMS_*` flags a capability that has no implementation. | `server/src/config.ts:99`, `services/market.ts:297` |
| 9 | Low | `quality.myIssues()` calls a non-existent route. | `client/src/lib/services.ts:319` |
| 10 | Low | Farmer verification request unreachable — no UI posts it; both "Request verification" buttons just navigate. | `pages/farmer/FarmerDashboard.tsx:163`, `FarmerQualityReports.tsx:153` |
| 11 | Low | Admin refund endpoint has no UI. | `pages/admin/AdminOrders.tsx` |
| 12 | Low | `.env` and `server/storage/` are group/world readable. | filesystem |

---

## 7. Verification log

Commands run and their observed results.

```
# auth boundaries
customer → /api/admin/overview, /api/admin/users, /api/admin/audit-logs, /api/admin/settings   → 403
anonymous → /api/admin/overview, /api/orders, /api/messages, /api/cart                          → 401
customer → POST /api/products, GET /api/dashboard/farmer                                        → 403

# broken contract
GET  /api/farmers/nearby-farmers?near_lat=17.4&near_lng=78.5&max_distance_km=200                → 400 INVALID_INPUT
GET  /api/dashboard/nearby-farmers?lat=17.4&lng=78.5&radius_km=200                              → 200 (distance_km present)
GET  /api/quality/ai-assess                                                                     → 404 NOT_FOUND
GET  /api/quality/issues/mine                                                                   → 404 NOT_FOUND
POST /api/quality/ai-assess  (JSON)                                                             → 503 AI_NOT_CONFIGURED
POST /api/quality/ai-assess  (multipart, as the client sends)                                    → 400 MISSING_FIELDS

# cross-tenant isolation
farmer B → PATCH  farmer A's product                                                            → 404 PRODUCT_NOT_FOUND
farmer B → DELETE farmer A's product                                                            → 404 PRODUCT_NOT_FOUND
customer → PATCH  any product                                                                   → 403 FORBIDDEN_ROLE

# RLS at the database
psql "$APP_DATABASE_URL" -c "SELECT count(*) FROM products"                 → 11   (owner sees 11)
psql "$APP_DATABASE_URL" -c "SELECT count(*) FROM customer_addresses"       → 0    (owner sees 2)
psql "$APP_DATABASE_URL" -c "UPDATE profiles SET role='admin' ..."          → UPDATE 0

# outbound HTTP in the entire server
grep -rn "fetch(" server/src   → 3 sites only: api.razorpay.com/v1/orders,
                                 api.razorpay.com/v1/payments/{id}/refund,
                                 api.openai.com/v1/chat/completions

# secret hygiene
scan for secret-shaped literals in server/src + client/src                      → none
scan built client/dist for live JWT_SECRET / DATABASE_URL / APP_DATABASE_URL    → none present

# vite env resolution
probe var added to repo-root .env, then `vite build`                            → absent from bundle
```

## 8. Environment variable status

Presence only — no value was read. From `.env` (root, 7 keys) and `.env.example`:

| Set | Unset |
|---|---|
| `NODE_ENV`, `PORT`, `DATABASE_URL`, `APP_DATABASE_URL`, `JWT_SECRET`, `APP_URL`, `API_URL` | `SMTP_*`, `MAIL_FROM`, `VITE_GOOGLE_MAPS_API_KEY`, `RAZORPAY_*`, `AI_VISION_*`, `SMS_*`, `AGMARKNET_*`, `RATE_LIMIT_DISABLED` |

`GET /api/health` reports `integrations` for all seven optional integrations;
all are currently `false`, which matches the variable table above.

## 9. Summary of what is real vs. what is pending

**Working end to end, verified:** registration and login for both roles, role-based
routing and protection, product listing with images, product discovery and
filters, cart, multi-seller checkout with idempotency, order lifecycle and
status transitions, inventory decrement, messaging, reviews, quality reports,
notifications, admin moderation and audit logging, RLS-enforced tenancy,
three-language UI.

**Pending configuration and/or implementation:** Google Maps (not implemented, not
just unconfigured), Razorpay checkout UI, AI image assessment (4 defects),
SMS/OTP (no implementation), Agmarknet ingestion (no public API; manual entry
works), SMTP email (falls back to logging).

No credential was invented and no integration is reported as working unless it
was exercised. `INTEGRATION_SETUP.md` remains accurate about what each missing
credential affects, with the two exceptions noted in findings 6 and 8.
