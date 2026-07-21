# Vantage — Gaps & Enhancements Backlog

Goal framing: a read-only, one-stop-shop tracker for a multi-currency, multi-broker portfolio. No trade execution.

**GAP** = something a correct/complete tracker needs that is missing or wrong today.
**ENH** = net-new capability that turns it from "a tracker" into "the tracker".

---

## Start-here tier (highest leverage)

These unlock most of the rest. If nothing else, do these in order.

1. **Realized P&L + cost basis** (GAP) — prerequisite for tax, honest returns, and not losing closed positions.
2. **Cash & contributions ledger** (GAP) — the denominator for any honest return number.
3. **Transaction ledger as source of truth + historical reconstruction** (GAP) — kills the snapshot dependency.
4. **TWR + MWR/XIRR + benchmark** (GAP) — makes the analytics you already have actually correct.
5. **Read-only broker aggregation API** (GAP) — the literal "multi-broker" promise.

---

## A. Data model & correctness foundations

- **A1 (GAP) Realized P&L + cost basis.** `toNetPositions` drops any position that nets to `<= 0` units, and nothing in `src/` computes realized gain/proceeds. Closed round-trips vanish; partial sells net against a blended average with no method choice. Add per-lot matching with a selectable basis (FIFO / average / specific-lot), persist a realized-gains record, and keep closed positions visible in a "Closed" view.
- **A2 (GAP) Cash & contributions ledger.** No deposits/withdrawals/transfers. Without net contributions you cannot compute a true return or answer "how much have I put in vs. what it's worth." Add cash transactions and per-broker cash balances.
- **A3 (GAP) Transaction ledger as source of truth.** Today history relies on `portfolio_snapshots` (only captured while the app runs). Make the lot/transaction log authoritative and reconstruct value history from transactions × historical prices, so a fresh import instantly shows full history.
- **A4 (GAP) Corporate actions.** Splits, reverse splits, mergers, spin-offs, ticker/symbol changes, delistings, rights/bonus issues, return of capital. A split currently corrupts units/price silently. Store as adjustment events and auto-heal affected lots.
- **A5 (GAP) Dividends/coupons as recorded income events.** `ticker_dividends.yield_ttm` + manual override is a *projection*, not received income. Record actual dividends, bond coupons, and interest as cash events (the `par_value`/`coupon_rate`/`maturity_date` metadata already exists to drive coupons). Support DRIP.
- **A6 (GAP) Fees in cost basis & net return.** `lots.fees` exists — confirm it actually flows into cost basis and net-of-fee return, and surface total fees paid to date.
- **A7 (ENH) FX conversions as transactions.** Model currency conversions between cash balances so multi-currency cash is trackable, not just holdings.

## B. Performance & analytics

- **B1 (GAP) Time-weighted return (TWR).** Flow-adjusted return that strips deposit/withdrawal timing. Current CAGR is computed off the raw snapshot value series, so contributions read as "returns."
- **B2 (GAP) Money-weighted return / XIRR.** Per holding, per account, and portfolio-wide.
- **B3 (GAP) Benchmark comparison.** Compare against S&P 500, MSCI World, STI, or a custom benchmark (VWRA is a natural default given the holdings). Show relative performance, alpha/beta.
- **B4 (ENH) Total return incl. dividends vs. price return.** Split the two explicitly.
- **B5 (ENH) Calendar-year & rolling returns table.** Since-inception, per-year, trailing 1/3/5y, annualized.
- **B6 (ENH) Attribution.** Which holdings/sectors/geographies/currencies drove return. Extend the existing FX-vs-asset attribution to per-holding and per-sector.
- **B7 (ENH) Risk metrics beyond Sharpe.** Beta, Sortino/downside deviation, correlation matrix, Value-at-Risk, per-holding volatility. (Sharpe / annualized vol / max drawdown already exist.)
- **B8 (ENH) Concentration & diversification score.** Single-name %, single-sector %, single-currency %, HHI, with warnings.
- **B9 (ENH) Yield analytics.** Current yield, yield-on-cost from real receipts, forward 12-month income projection.

## C. Multi-broker (the headline)

- **C1 (GAP) Broker as a first-class entity.** Broker is a free-text string on the lot. Promote to a table: logo, type, connection status, last-sync time.
- **C2 (GAP) Read-only aggregation API.** Integrate SnapTrade / Plaid Investments / Akoya / Yodlee — pull holdings + transactions with no trade scope (fits the read-only constraint). One integration beats N parsers. Verify current coverage of the brokers your users actually hold (US well-covered; SG/Asia varies).
- **C3 (GAP) Generic column-mapping CSV importer.** A mapping UI ("which column is ticker/units/price/date?") with saved per-broker mappings, so *any* broker export works without new code.
- **C4 (ENH) More broker parsers.** IBKR, Tiger, moomoo, Webull, Saxo, POEMS/PhillipCapital, Standard Chartered, Syfe, Endowus, Revolut, Trading212, Schwab/Fidelity/Robinhood. (Currently FSMOne + DBS Vickers.)
- **C5 (GAP) Import reconciliation & dedup.** Transaction-hash dedup, an import-history table, and a staging→confirm step so re-uploading an overlapping statement is safe.
- **C6 (ENH) Per-broker views.** Allocation, value, performance, and cash broken out per broker.
- **C7 (ENH) Account types as first-class buckets.** Taxable / SRS / CPFIS / retirement. The `source` field (`CPF | SRS | Cash`) is the seed — promote it to a grouping dimension across the whole UI.
- **C8 (ENH) Balance reconciliation.** Compare computed vs. broker-reported balance and flag drift.

## D. Asset coverage

- **D1 (ENH) Fixed income done properly.** Yield-to-maturity, accrued interest, coupon schedule from existing metadata; Singapore Savings Bonds (SSB) and T-bill support.
- **D2 (ENH) Funds / unit trusts / robos.** NAV-based tracking (Endowus, Syfe, StashAway).
- **D3 (ENH) Crypto depth.** Staking rewards as income, multiple wallets/exchanges, on-chain address import, cost basis across venues.
- **D4 (ENH) Options / derivatives.** At least position tracking and P&L.
- **D5 (ENH) Private / illiquid assets → net worth.** Property (exists), fixed deposits, savings accounts, private equity, collectibles — a full net-worth view.
- **D6 (ENH) Watchlist.** Track instruments you don't own.
- **D7 (ENH) Fundamentals & events.** P/E, market cap, sector, earnings calendar, analyst ratings, insider transactions (Finnhub already provides several).

## E. Income & tax

- **E1 (ENH) Dividend calendar.** Ex-div / pay dates, upcoming payments.
- **E2 (ENH) Passive-income dashboard.** Monthly income, projected annual, income growth.
- **E3 (GAP-for-real-users) Tax reports.** Realized capital-gains report, dividend-income summary, exportable (CSV/PDF).
- **E4 (ENH) Foreign withholding tax.** Capture the US 30% dividend WHT (major for SG investors, poorly served elsewhere).
- **E5 (ENH) SG-specific.** SRS contribution + tax-relief tracking, CPFIS limits, an explicit "no capital gains tax in SG" framing so realized-gains reporting is positioned correctly.
- **E6 (ENH) US-user extras.** Wash-sale awareness, tax-loss-harvest hints.

## F. Alerts, notifications & automation

- **F1 (GAP) Scheduled background refresh & snapshotting.** Move price refresh + snapshotting to a scheduled job (Supabase Edge Function / cron) instead of on-demand-while-open. This is what makes history reliable regardless of whether anyone opened the app.
- **F2 (ENH) Price alerts.** Above/below thresholds.
- **F3 (ENH) Portfolio alerts.** Value milestones, drawdown, allocation-drift/rebalance triggers.
- **F4 (ENH) Income alerts.** Dividend received / upcoming.
- **F5 (ENH) Corporate-action notifications.** Split/merger/ticker-change heads-up.
- **F6 (ENH) Digests.** Daily/weekly email or push summary.
- **F7 (ENH) News-sentiment alerts.** Leverage the existing multi-source news + sentiment tagging.

## G. Planning & goals

- **G1 (ENH) Target allocation + rebalancing suggestions.** Compute-only (stays read-only) — "sell X, buy Y to hit target" as guidance, no execution.
- **G2 (ENH) Goals & net-worth targets.** Retirement number, savings goals, progress tracking.
- **G3 (ENH) Retirement / FIRE projection.** Natural home for the `feat/cpf-life-calculator` branch — fold CPF LIFE into a full retirement projection.
- **G4 (ENH) Scenario & stress testing.** What-if a position is added, or a market crash; Monte Carlo projection.
- **G5 (ENH) DCA / contribution tracking.** Track recurring contribution plans against target.

## H. UX & product

- **H1 (ENH) Onboarding + sample portfolio + empty states.** Critical the moment non-technical users arrive.
- **H2 (ENH) Multiple portfolios per user.** "Mine", "spouse", "kids", plus a consolidated view.
- **H3 (ENH) Household / shared read-only view.** Combine several users' portfolios.
- **H4 (ENH) Trade journal.** Expand the `strategy`/`notes` fields into thesis tracking per position.
- **H5 (ENH) Search, filter, tagging.** Across holdings and transactions.
- **H6 (ENH) Reporting & export.** PDF statement, CSV, print-friendly, full-backup export/import for portability.
- **H7 (ENH) Time-travel.** "Portfolio as of date X."
- **H8 (ENH) Dashboard customization.** Rearrangeable widgets, saved layouts.
- **H9 (ENH) Mobile / PWA polish.** Responsive + installable.
- **H10 (ENH) Lean into the terminal.** Keyboard shortcuts, command palette.
- **H11 (ENH) Accessibility (WCAG) & i18n.**

## I. AI & analysis

- **I1 (ENH) Function-calling over live data.** Let the analyst query the DB (holdings, realized P&L, income, benchmark) rather than a static snapshot stuffed into the prompt.
- **I2 (ENH) Natural-language portfolio Q&A.** "What's my tech exposure?", "How did I do in Q2 vs. the S&P?"
- **I3 (ENH) Scheduled AI reports.** Auto monthly/quarterly review.
- **I4 (ENH) Anomaly detection.** Flag unusual position moves or data drift.
- **I5 (ENH) Richer grounding.** Once realized P&L, income, and benchmark exist, feed them in so commentary stops being price-only.

## J. Data reliability & infrastructure (esp. for multi-user)

- **J1 (GAP) Historical price backfill service.** So imported transactions get accurate value history (pairs with A3).
- **J2 (ENH) Extend the shared price cache.** `ticker_quotes` is already shared — fetch each instrument once and serve all users; the more users, the bigger the win.
- **J3 (GAP) Per-user API quota accounting.** EODHD (~$20/mo) behind one shared env key does not survive multi-user — one heavy user starves everyone and you eat the bill. Add per-user quotas / tiering.
- **J4 (ENH) Provider fallback chains + circuit breakers + staleness indicators.** Show price age, source, and confidence; flag stale/failed fetches in the UI.
- **J5 (ENH) Observability.** Error tracking (Sentry), provider-health dashboard.
- **J6 (ENH) Backup / restore.** Point-in-time recovery for user data.

## K. Security, privacy & trust (once it holds other people's money data)

- **K1 (GAP) Legal & privacy.** Privacy policy, ToS, PDPA (Singapore) + GDPR compliance: data export, right-to-deletion (self-delete exists — extend), consent.
- **K2 (ENH) MFA / 2FA.**
- **K3 (ENH) Surface the audit log.** The `audit` table exists — expose session history and suspicious-login alerts to users.
- **K4 (ENH) Secrets & at-rest encryption.** Especially if aggregation tokens are stored — vault them, never store broker credentials.
- **K5 (ENH) Market the read-only guarantee.** "We physically cannot place a trade" is a trust feature — say it loudly. Pairs with a verifiable no-training-data stance on the AI side.
- **K6 (ENH) Dependency scanning + pen-test + CSP review.** (CSP nonce already present.)

## L. Monetization & go-to-market (if it becomes a real product)

- **L1 (ENH) Multi-tenant SaaS tiering.** Free / Pro with usage limits that map to your data-API costs (see J3).
- **L2 (ENH) Billing.** Stripe subscriptions + management.
- **L3 (ENH) Opt-in public/anonymized portfolio sharing + referrals.**
- **L4 (ENH) Landing / marketing.** Build on the existing landing branches.

---

## Note on current branch trajectory

The seven in-flight branches (CPF LIFE calculator, total-units column, delete-all-lots,
PDF hardening, CSV import fix, Yahoo fallback, landing layout) are all incremental polish
on the existing manual-entry, single-user model. Good, shippable — but none touch the
Start-here tier. If the goal is genuinely "one-stop shop across brokers," the center of
gravity needs to shift toward A1–A3, B1–B3, and C1–C2. Everything else compounds on top
of those.
