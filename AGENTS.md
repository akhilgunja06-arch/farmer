# AGENTS.md — RythuDirect

Farmer-to-customer marketplace for India. npm workspaces: `server/` (Express + TypeScript + PostgreSQL 17) and `client/` (React + Vite + Tailwind).

## Commands

```bash
npm run dev --workspace server     # API on :12001
npm run dev --workspace client     # Vite on :12000, proxies /api to the server
npm test --workspace server        # e2e acceptance suite (scripts/e2e.sh)
npm run build --workspace client   # tsc -b && vite build
npm run db:seed --workspace server # demo data (password: RythuDemo123)
```

Typecheck: `npx tsc -b` in `client/`, `npx tsc --noEmit` in `server/`.

## Database and roles

Two roles, and the distinction matters:

- `rythu_app` (owner, `DATABASE_URL`) bypasses RLS. Used only for migrations and seeding.
- `rythu_web` (`APP_DATABASE_URL`, `NOBYPASSRLS`) is the runtime role. The API connects as this, so **RLS is the real authorization boundary** — hiding a button proves nothing.

A direct `psql "$APP_DATABASE_URL"` query returns almost nothing because of RLS. To inspect real data, use `$DATABASE_URL`.

## Conventions

- API list endpoints return `{ items, page, page_size, total, total_pages }` (`Paginated<T>` in the client). Detail endpoints that return a resource plus a collection put them as **siblings**, not nested (e.g. `GET /api/messages/:id` → `{ conversation, messages }`).
- Financial values are `numeric` in the DB and validated server-side; never trust client-sent prices or quantities.
- Order/payment status may only change server-side. Never render "payment successful" from a frontend callback.
- i18n: three locales (`en`, `te`, `hi`) in `client/src/locales/`. Add keys to all three; `en` is the source of truth.

## Pitfalls found in this repo

- `Modal` (`client/src/components/ui/Modal.tsx`) runs a focus-trap effect. It must depend only on `open` and read `onClose` from a ref — callers pass a fresh arrow function each render, and re-running the effect on every keystroke steals focus and swallows input after the first character.
- Modals that show a success state must reset that state on close, or reopening shows a stale success screen.
- `seed.ts` guards inserts behind `count(*) == 0` checks, so re-seeding a populated database is a no-op.

## Testing notes

- `scripts/e2e.sh` starts its own API on a random port with rate limiting disabled, drives real farmer/customer/admin journeys over HTTP with session cookies, and does **not** reset the DB. It leaves `E2E *` users and products behind — clean them up (delete their orders first; `order_items.farmer_id` is `RESTRICT`) so they don't show as active public listings.
- Integration status is surfaced at `GET /api/health` and in the admin settings page. Unconfigured integrations (email, maps, payments, AI vision, SMS, market data) are expected to degrade gracefully, not crash.
