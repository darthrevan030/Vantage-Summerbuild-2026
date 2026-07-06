# Feature Backlog: Scoping Notes

_Scoped 2026-07-06, grounded in the codebase as it stood on `feat/cpf-life-calculator`. These are backlog candidates, not committed roadmap — re-verify file references before starting implementation, since the code will have moved on._

## 1. SRS withdrawal tax planner

**Goal:** help the user model how much to withdraw from SRS per year to manage tax bracket impact (SRS withdrawals are taxable in Singapore; only 50% is taxable after the statutory retirement age).

**Current gap:**
- SRS exists only as a `fund_source` tag (`"SRS"`) on `holdings` rows (`src/types/holding.ts`). No dedicated balance table, no contribution cap tracking, no withdrawal history.
- No `srs_balances` table anywhere in `supabase/migrations/` (unlike `cpf_balances`, which has `oa/sa/ma/ra/as_at_date`).
- No date-of-birth, tax residency, or income/bracket fields anywhere in `user_settings` or elsewhere — confirmed via repo-wide search, zero matches.

**What's needed:**
- New `srs_balances`/`srs_contributions` table mirroring `cpf_balances`: SRS cash balance, cumulative contributions vs. annual cap (currently $15,300 citizens/PR, $35,700 foreigners), withdrawal history by year.
- New `user_settings` fields: birth year (for statutory retirement age), tax residency status, annual income or marginal bracket.
- A Singapore income-tax bracket table, likely in `app_config` (mirroring how `cpf_life_rates` is stored today) so it can be updated without a code change when brackets shift.

**Implementation sketch:**
- Reuse the CPF LIFE payout estimator pattern already in `overview/page.tsx` (state input → derived projection card), or give this its own page.
- New `/api/srs` route, analogous to `/api/cpf`.
- Core logic: given current SRS balance + statutory retirement age + tax residency, project a multi-year withdrawal schedule that minimizes total tax, applying the 50% concession post-retirement-age.

**Effort:** medium-large — new schema, new settings fields, tax logic, new UI. Natural to build alongside the CPF LIFE calculator already in progress on this branch, since both need the "statutory retirement age" concept.

**Open questions:** how to keep the tax bracket table current given annual SG budget changes; whether this should integrate with the CPF LIFE calculator for a combined retirement-income view.

---

## 2. Household / shared portfolio view

**Goal:** let a linked user (e.g. a spouse) grant another user read access to their portfolio for a combined view — distinct from the existing admin oversight model, which is for staff/admin, not peer-to-peer sharing.

**Current gap:**
- Role model (`src/lib/roles.ts`) is flat (`user`/`admin`/`superadmin`) with no relationship/grouping concept — permissions are role-based, not relationship-based.
- RLS is **already inconsistent**: only `lots` and `user_settings` have an admin-read OR-clause (`auth.uid() = user_id OR is_admin()`). `cash_balances`, `cpf_balances`, `portfolio_snapshots`, and `holding_overrides` are self-only with **no** admin-read policy at all. Sharing requires net-new RLS work across most of these tables, not an extension of an existing pattern.
- `src/app/(dashboard)/layout.tsx` hardcodes a single `user.id` for `fetchHoldings`/`fetchUserSettings`/`fetchSnapshots`.
- `src/context/portfolio.tsx` is presentational only — it has no owner-tagging concept on `HoldingRow` or elsewhere, though it could accept pre-merged multi-owner data if the caller supplied it.

**What's needed:**
- New `household_links` table (`owner_id`, `viewer_id`, `status` pending/accepted).
- A `is_linked_viewer(target_user_id)` SECURITY DEFINER helper mirroring `is_admin()`.
- RLS policy additions on `lots`, `cash_balances`, `cpf_balances`, `portfolio_snapshots`, `holding_overrides`, `user_settings`.
- Data layer changes so `fetchHoldings`/`fetchSnapshots`/`fetchUserSettings` accept an array of user_ids and merge; tag each `HoldingRow`/snapshot with an `owner_id`/`ownerLabel`.
- Layout changes to resolve accepted links and fetch+merge per linked user.
- UI: invite/accept flow, and a merged-vs-per-person view toggle (likely with owner color-coding).

**Effort:** large, and the highest-risk item in this list — RLS mistakes on financial data are the failure mode to design against carefully. Recommend **read-only** sharing only (no write delegation) to start.

**Open questions:** pairwise links only (couples) or arbitrary groups; revoke flow; whether a linked viewer should see CPF/SRS balances or only investment holdings.

---

## 3. Broker API import

**Goal:** sync holdings directly from a broker's API instead of manual PDF statement upload.

**Current gap:**
- The `ParsedTrade`/`ParseResult` contract (`src/lib/pdf-parsers/types.ts`), the post-parse enrichment pipeline (ticker resolution via Yahoo, ETF upgrade via EODHD, FX fill via Frankfurter — all in `src/app/api/parse-pdf/route.ts`), the review-before-commit UI (`PdfImportPanel` in `add/page.tsx`), and the `POST /api/holdings` commit path are all generic over `ParsedTrade[]` and directly reusable.
- Per-user credential storage is fully greenfield: no `pgcrypto`/Vault usage anywhere in migrations, no per-user API-key/OAuth-token table or columns. Existing third-party keys (EODHD, etc.) are server-side env vars shared across all users, not per-user secrets — there's no precedent to extend.

**What's needed:**
- New encrypted `broker_connections` table (user_id, broker, encrypted token/secret, expiry).
- Real broker API adapters — each broker has a different auth model (IBKR: OAuth + session gateway; Tiger/Moomoo: API key + secret + device cert) — mapping each broker's native schema to `ParsedTrade`.
- A sync mechanism: no webhook infra exists today, so either polling/cron (Vercel cron) or a manual "sync now" button.

**Implementation sketch:** pilot a single broker first (IBKR's Flex Query/API is comparatively standardized), build one adapter producing `ParsedTrade[]`, and reuse the existing review-table UI, enrichment pipeline, and `/api/holdings` commit path unchanged.

**Effort:** large, with ongoing maintenance burden (each broker's API differs, and auth/rate limits shift independently). Recommend a single-broker spike rather than a general adapter framework, and a security review before storing brokerage credentials.

**Open questions:** which broker to pilot; real-time sync vs. on-demand button (the latter avoids cron complexity initially); regulatory considerations around storing brokerage credentials.

---

## 4. News relevance enhancement

**Goal:** fix news results that aren't relevant to the queried holding.

**Current gap** (all in `src/app/api/news/route.ts`):
- `fetchNewsForSymbol` waterfalls Finnhub → Alpha Vantage → NewsAPI and stops at the **first provider that returns anything** — no merge or ranking across providers.
- Alpha Vantage's own `ticker_sentiment[].relevance_score` field is fetched and logged but never used to filter or rank results — it's discarded.
- No post-fetch check that the ticker or company name actually appears in the returned headline/summary; results are trusted purely on query specificity.
- The `EODHD_TO_FINNHUB` exchange-suffix map is incomplete; an unmapped exchange silently falls back to a bare ticker (`?? ""`), risking cross-exchange symbol collisions (same ticker code, different market).
- No dedup by URL/title across or within a provider's results.

**What's needed:**
- Use Alpha Vantage's `relevance_score` to filter/sort instead of discarding it.
- Add a post-fetch relevance filter: keep only items where the ticker or a company-name token appears in the headline/summary.
- Merge and rank top results across providers instead of first-wins; or at minimum, fall through to the next provider when the top result's relevance is low, not only when the result set is empty.
- Fill gaps in `EODHD_TO_FINNHUB`, and fail closed (skip Finnhub for unmapped exchanges) rather than fall back to an ambiguous bare ticker.
- Dedup by URL/title similarity.

**Effort:** small-medium. Contained to one file, no schema changes. Good near-term win.

---

## 5. Analysis accuracy enhancement

**Goal:** make AI-generated portfolio analysis specific and accurate instead of generic.

**Current gap** (`src/app/api/analyst/route.ts`, `src/app/(dashboard)/analysis/page.tsx`):
- The sentiment prompt explicitly instructs the model to reason from "general knowledge" and never claim access to live data — by design, this is the single biggest driver of generic output, not a model limitation.
- Sentiment mode sends only `id`, `type`, and a single 30-day price delta per holding — no price, cost basis, weight/%, sector, currency, or dividend data, even though all of this is already computed in `usePortfolio()` (`assetAllocation`, `geoAllocation`, `hero`, `currencyCards`) and simply never passed through.
- Ask mode sends `name`, `assetType`, `totalPct` (this is P&L % change, not portfolio weight — easily conflated) and `totalSGD`, but no allocation breakdown or absolute figures.
- News headlines are fetched (`/api/news`) and shown in the UI drawer, but never reach the model — "drivers" are guessed from static training knowledge instead of the actual fetched articles.
- No instruction requires the model to cite the specific numbers it was given, so boilerplate prose isn't penalized.
- `maxTokens: 350` on Ask mode caps answer depth; no `temperature` is set explicitly for either mode.

**What's needed:**
- Thread the already-computed `assetAllocation`/`geoAllocation`/`hero`/`currencyCards` data into both prompts.
- Send actual portfolio weight % per holding alongside P&L %.
- Thread the already-fetched news headlines into the sentiment prompt as grounding context.
- Reframe the system prompt from "don't claim live data" to "here is live data — analyze only from this and cite the specific figures."
- Raise `maxTokens` for Ask mode; consider a lower temperature for the more factual Ask task vs. the more generative sentiment task.

**Effort:** small-medium. Plumbing across 2-3 files (`route.ts`, `analyst-api.ts`, `analysis/page.tsx`), no infra/schema changes. Pairs well with the news fix as a near-term win.

---

## Recommended sequencing

1. **News relevance** and **analysis accuracy** — both contained, no schema changes, good quick wins.
2. **SRS withdrawal tax planner** — pairs naturally with the CPF LIFE calculator work already on this branch.
3. **Household/shared portfolio view** and **broker API import** — both large, security-sensitive (cross-table RLS; credential storage), and deserve their own dedicated scoping/security pass before starting.
