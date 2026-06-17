<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Codebase Guide

> A finance/portfolio dashboard. Track your holdings (stocks, ETFs, REITs, bonds, T-bills, gold, real estate), CPF/SRS/cash balances, FX exposure, dividends, and AI-generated analysis. Built for a Singapore (SGD-base) investor.
>
> **Last reviewed:** 2026-06-16. Keep this section current when you make structural changes.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16.2.7 (App Router, React 19) — see breaking-changes note above |
| Language | TypeScript 5 (strict) |
| Database / Auth | Supabase (Postgres + Row Level Security + Google OAuth) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/postcss`), CSS variables for theming |
| Animation | `motion` (Framer Motion) — landing page only |
| AI | `@anthropic-ai/sdk` — streaming analysis/Q&A (use latest Claude models) |
| Prices/FX | `yahoo-finance2`, Frankfurter (FX), EODHD, Finnhub |
| News | Finnhub (US equities) · Alpha Vantage (non-US, crypto, gold) · NewsAPI (fallback) |
| PDF parsing | `pdf-parse` — broker statement import (FSMOne, DBS Vickers) |
| Notifications | `sonner` (toasts) |
| Hosting | Vercel (`@vercel/analytics`, `@vercel/speed-insights`) |

**Scripts:** `npm run dev` · `npm run build` · `npm run lint` (eslint). No test runner is configured. Type-check with `npx tsc --noEmit`.

## The big picture: how data flows

The app is **server-rendered with a single heavy data fetch at the dashboard layout**, then handed to a client context. Understand this and everything else falls into place:

```
src/app/(dashboard)/layout.tsx   ← SERVER component, force-dynamic
  ├─ fetchHoldings / fetchUserSettings / fetchSnapshots   (Supabase, parallel)
  ├─ compute* / generate* functions from lib/portfolio.ts (all derived data)
  └─ <DashboardShell ...props>                            (passes everything down)
        └─ PortfolioProvider (src/context/portfolio.tsx)  ← CLIENT context
              └─ every dashboard page calls usePortfolio()
```

- **Pages do NOT fetch their core data.** They read it from `usePortfolio()`. The layout already computed holdings, hero stats, allocations, movers, currency cards, waterfall, portfolio time-series, and FX series.
- **Currency conversion is centralised in the context.** All money values are stored in **SGD**. `usePortfolio()` exposes `toBase()`, `fmtVal()`, `fmtSigned()` which convert SGD → the user's chosen base currency for display. Never format currency by hand in a page — use these.
- **Mutations** (add/edit/sell/delete, refresh prices, settings) go through `src/app/api/**` routes, then call `router.refresh()` to re-run the server layout and pull fresh data.

## Directory map

```
src/
├─ app/
│  ├─ (auth)/              Login page + OAuth callback route
│  ├─ (dashboard)/         All authed pages; layout.tsx does the master fetch
│  │   ├─ overview/ holdings/ add/ analysis/ charts/ fx-lab/ settings/ admin/
│  │   └─ layout.tsx       ★ entry point for dashboard data flow
│  ├─ api/                 Route handlers (see API surface below)
│  ├─ layout.tsx           Root layout (theme, fonts, analytics)
│  └─ page.tsx             Public landing page
├─ components/
│  ├─ (top level)          DashboardShell, NerveBar, TabBar, SummaryRail, Select, Icon, RoleToggle, ActiveToggle, DeleteUserButton, etc.
│  ├─ charts/              AreaTrend, Donut, Dumbbell, FXArea, Legend, Spark
│  └─ landing/             Marketing/landing animations (motion-heavy)
├─ context/portfolio.tsx   ★ client-side portfolio state + currency conversion
├─ hooks/                  useCachedList, useCurrencies, useExchanges, useFxSparks, useOptimisticToggle
├─ lib/
│  ├─ supabase/            DB layer: client/server/admin, data.ts (all queries), guards, delete-user (purgeUser), rate-limit, app-config
│  ├─ providers/           External data: fx, sgx, dividends, history
│  ├─ pdf-parsers/         Broker statement parsing: types.ts, index.ts (detectBroker), fsmone.ts, dbs-vickers.ts
│  ├─ api/client/          analyst-api.ts (streamSentiment/streamAsk)
│  ├─ api/server/          list-route.ts (createTableListGET factory)
│  ├─ portfolio.ts         ★ all compute*/generate* derived-data functions
│  ├─ prices.ts            Live price fetching + symbol mapping per provider
│  ├─ group-holdings.ts    Aggregate lots → positions (toNetPositions, groupHoldings)
│  ├─ formatters.ts        NF, pct, rate, ccyFmt, ccySigned, CCY_SYMBOL, CCY_FLAG, SUPPORTED_CURRENCIES
│  ├─ roles.ts             ★ Role type + permission matrix (canSetRole/canDeleteRole, isAdminRole)
│  └─ fx.ts, positions.ts, hexA.ts, useCountUp.ts, useDateRange.ts
├─ types/                  holding, portfolio, settings, snapshot, chat
└─ proxy.ts                Edge middleware: CSP (nonce), Supabase session refresh
supabase/migrations/       Schema history (see Data model)
design/                    ⚠️ Old .jsx mockups — NOT used by the app (prototype leftovers)
```

## Data model (core domain types)

Defined in `src/types/holding.ts`. The DB schema was **normalized** (migration `20260615100000`) into **instruments** (one per security), **lots** (individual buy transactions), and **overrides** (per-user manual fields). The app re-assembles these into:

- **`Holding`** — one lot, fully denormalized (ticker, units, prices, FX rates, asset type, source, dividend/bond fields…).
- **`HoldingRow`** — a `Holding` plus computed SGD figures (`costSGD`, `valueSGD`, `assetGain`, `fxGain`, `totalPct`) and a `detail` block. **This is the main currency you pass around the UI.**
- **`GroupedHolding`** — multiple lots of the same ticker aggregated into one row (for the grouped holdings view).
- Asset types: `Equity | ETF | REIT | Gold | RE | Bond | T-Bill` (`ASSET_TYPES` array + `FIXED_INCOME_TYPES` = {Bond, T-Bill} in `types/holding.ts`). Fund sources: `CPF | SRS | Cash`.
- ⚠️ **`instruments` rows are SHARED across users** (deduped by `(symbol, exchange_code)` via `upsertInstrument`). Symbol, currency, asset_type, name, flag, par/coupon/maturity all live on this shared row — editing them affects **every** user holding that security. `lots` and `holding_overrides` are the only per-user data. See the shared-instrument auth rule under Conventions.

## Currency vs. listing exchange (important domain rule)

Currency and exchange are **independent** — a security can be denominated in a currency other than its exchange's local one (e.g. **VWRA is listed on the LSE but denominated in USD**, not GBP). Never derive currency from the exchange.

- A holding's stored **currency = the denomination of its price**. It's what drives FX→SGD conversion *and* the price-provider symbol suffix: `EODHD_EXCHANGE` maps **currency → exchange suffix** (`prices.ts`). If a ticker already carries an explicit suffix (`VWRA.LSE`), that dot wins and the currency map is bypassed — so the exchange suffix and the currency are set independently and must each be correct.
- **Auto-heal:** the refresh route reads each ticker's authoritative currency **and asset type** from Yahoo in one batched call (`fetchTickerMeta` in `prices.ts`) and repairs mismatched instruments via `correctInstrumentCurrency` / `correctInstrumentAssetType` (`data.ts`). Currency: only corrects to a *clean, supported* currency that *differs* from storage; pence-quoted UK lines come back as `"GBp"` and are deliberately ignored (price is in pence, not pounds); corrected currencies are folded into the FX-rate refresh set. Asset type: only ever **upgrades to `ETF`** — `mapYahooQuoteType` trusts Yahoo's unambiguous `"ETF"` signal but never heals toward `Equity` (Yahoo lumps REITs under `EQUITY`, and Gold/RE/Bond/T-Bill are app conventions Yahoo doesn't model), so a correctly-set REIT/Gold/Bond is never clobbered.

## API surface (`src/app/api/`)

User-scoped (require auth): `holdings` (+ `/refresh` `/backfill` `/dividends` `/ratios`), `cash`, `cpf`, `settings`, `account` (self-service account deletion — `DELETE`), `prices`, `quotes`, `fx` (+ `/candles`), `portfolio/analytics`, `portfolio/fx-series`, `news` (multi-source: Finnhub → Alpha Vantage → NewsAPI, with exchange-aware ticker remapping), `parse-pdf` (POST multipart/form-data — broker statement → trades array; supports FSMOne (ETF confirmation + consolidated statement) and DBS Vickers (Monthly **Securities Holdings** snapshot → holdings, last-done price as buy price; dividend/cash advices return a friendly no-op); handles true PDF and HTML-saved-as-PDF; after parsing, the route best-effort enriches each trade — resolves blank tickers from company names via Yahoo search (`resolveTickersFromNames`, conservative: confident US match only, blanks share-class collisions), upgrades ETF asset types via EODHD, and fills missing `buy_fx_rate` via Frankfurter (`fetchCurrentSgdRates`); 10 MB limit), `analyst` (Anthropic streaming).
Reference lists: `currencies`, `exchanges` (built on the `createTableListGET` factory).
Admin-only (require admin/superadmin role): `admin/users/[id]` (`PATCH` role change, `DELETE` user), `admin/currencies/[code]`, `admin/exchanges/[code]`, `admin/config/[key]`.

**Server-side guard helpers** live in `src/lib/supabase/guards.ts`: `requireAuth()` returns `{ user, error }`; `requireAdmin()` returns `{ user, adminClient, role, error }` (the service-role client + the viewer's role). Return `error` early if present. Rate limiting via `enforceRateLimit()` (`rate-limit.ts`); provider on/off flags via `getProviderFlags()` (`app-config.ts`).

## Auth, identity & roles

User identity is **split across two stores** — the single most common source of confusion here:

- **`auth.users`** (Supabase Auth schema) owns email, `created_at`, and the UUID. Read it only via the **admin/service-role client** (`auth.admin.listUsers`, `getUserById`); it is not in the `public` schema and the table editor hides it.
- **`public.user_settings`** owns `display_name`, `base_currency`, and `role`. Rows are **created lazily on first login** (upsert), so an account can exist in `auth.users` with **no** `user_settings` row yet. The admin users table merges the two and defaults a missing role to `user`. Any write targeting `user_settings` by `user_id` must therefore **upsert, not update**, or it 404s on never-logged-in accounts.

**Three-tier role model** — `src/lib/roles.ts` is the single source of truth (pure, import-free), used by **both** API routes and UI so they enforce the same matrix:

- `user` → `admin` → `superadmin`, each a strict superset.
- `is_admin()` (Postgres, `SECURITY DEFINER`) spans **both** admin tiers — every RLS policy keys off it, so superadmins inherit all admin data access without per-policy edits.
- **Only superadmins** may change roles (promote/demote) or delete admins/superadmins; plain admins may delete ordinary `user`s only. Enforced by `canSetRole`/`canDeleteRole`; the UI hides exactly what the API would reject.
- **Invariant: ≥1 superadmin always exists.** The `prevent_last_superadmin_loss` trigger fires `BEFORE UPDATE OF role` **and** `BEFORE DELETE` on `user_settings` as the race-proof backstop; routes also do a friendly pre-check. Column-level grants additionally `REVOKE` `role` writes from `authenticated`, so role can only change through the service-role admin routes.

**User deletion is app-level, not a DB cascade.** `user_id` is `text` while `auth.users.id` is `uuid`, so no FK cascade is possible. `purgeUser` (`lib/supabase/delete-user.ts`) deletes the user's rows across every user-scoped table — `lots`, `holding_overrides`, `portfolio_snapshots`, `cash_balances`, `cpf_balances`, `rate_limits`, `user_settings` — **then** the Auth account (data-first, so a mid-way failure leaves a recoverable account, not orphaned data). Shared `instruments` and the `audit_log` trail are never purged. Two callers share it: admin `DELETE /api/admin/users/[id]` (role-gated, blocks self) and self-service `DELETE /api/account` (signs the session out afterward). ⚠️ The deletes are sequential, not a single transaction (the JS client can't span one) — best-effort with logging.

## Conventions & gotchas

- **All monetary values are in SGD internally.** Convert to display currency only via the `usePortfolio()` helpers.
- **Pages read from context, not fetch.** If you need new derived data on a page, add a `compute*` function in `lib/portfolio.ts`, call it in `(dashboard)/layout.tsx`, thread it through `DashboardShell` → `PortfolioProvider`, then consume via `usePortfolio()`.
- **After a mutation, call `router.refresh()`** to re-run the server layout instead of manually re-fetching.
- **`src/proxy.ts` is the middleware** (CSP nonce + Supabase auth refresh) — not a conventional name; don't delete it expecting a `middleware.ts`.
- **`design/` is dead weight** — mockups, nothing in `src/` imports it.
- **Reference-list pages** (currencies, exchanges) use the `useCachedList` hook + `createTableListGET` server factory. Reuse these rather than hand-rolling fetch+cache.
- **Editing shared `instruments` is auth-gated by sole ownership.** `updateInstrumentForLot` (`data.ts`) only mutates the instrument when *no other user holds it* (cross-user lot count via the admin client — RLS hides other users' lots from the user-scoped client, so they'd otherwise look unshared). It returns `InstrumentEditResult` (`ok | not_found | shared | error`); the holdings `PATCH` maps `shared` → **409**. This stops one user from re-pointing/re-denominating a security other users hold (cross-tenant tampering). The two instrument-write paths have *deliberately different* trust models: the **user PATCH is sole-holder gated** (attacker-chosen value), while the **refresh auto-heal is ungated** because it writes only provider-reported market truth.
- **The holding edit card sends instrument-level fields only when changed.** `DetailCard` in `holdings/page.tsx` diffs `name`/`ticker`/`currency`/`asset_type` against the original `HoldingRow` and omits unchanged ones — otherwise an unrelated lot edit (units, fees…) on a shared holding would be rejected by the sole-holder guard for a field the user never touched.
- **Responsive data tables: drop low-priority columns, don't rely on horizontal scroll.** For narrow screens hide secondary columns by breakpoint (e.g. `max-bp600:hidden` on both `<th>` and `<td>`) so action columns stay visible; add `whitespace-nowrap` to headers to prevent label overlap. `overflow-x-auto` is only a fallback, and inside a flex column it needs `min-w-0` on the flex ancestor to engage (the dashboard page roots already set `min-w-0`). See `admin/page.tsx` users table.

## Known tech debt (see `report.md` for the full cleanup plan)

- **Dead code:** `lib/seed.ts` (whole file), `groupIntoPositions`/`Position` in `lib/positions.ts`, `streamAnalysis` in `lib/api-client.ts`, `applyAccent` in `lib/hexA.ts`.
- **Giant page components:** `holdings/page.tsx` (~1600 lines), `add/page.tsx` (~1170), `analysis/page.tsx` (~910) — mix data, state, and UI; need component/hook extraction.
- **API boilerplate:** ~15 routes repeat the `requireAuth` guard by hand; validation regexes (`CCY_RE`, `DATE_RE`) and symbol maps (`EODHD_CODE_REMAP`) are duplicated across files.
- **Misplaced hooks:** `useCountUp.ts` / `useDateRange.ts` live in `lib/` but belong in `hooks/`.
- ⚠️ `buildFxColors` / `buildBaseFxRates` in `lib/portfolio.ts` LOOK unused but ARE used in `(dashboard)/layout.tsx` — do not delete.
