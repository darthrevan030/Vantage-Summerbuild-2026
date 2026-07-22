# Portfolio Backup / Restore — round-trippable export & import

**Date:** 2026-07-22
**Status:** Design approved, pending spec review

## Problem

The dashboard can **export** portfolio data two ways, but neither can be
**imported** back:

- **"Export JSON"** (add page, [`add/page.tsx`](../../../src/app/(dashboard)/add/page.tsx)) dumps the raw
  `GET /api/holdings` response — the full `Holding[]` in **camelCase**
  (`buyPrice`, `buyDate`, `assetType`, `transactionType`, `fees`, `sparkData`,
  plus server-owned `id`/`userId`/`createdAt`).
- **"Export CSV"** (holdings page) writes a **display report** — computed SGD
  columns (`Value SGD`, `Asset Gain`, `Total %`), not re-importable fields.

The only import path is the CSV column-mapper, which expects a **snake_case
subset** (`name, ticker, asset_type, strategy, broker, units, currency,
buy_price, buy_date, buy_fx_rate`), forces `broker: "Imported"`, and treats
every row as a **buy**.

So the JSON "backup" is a dead end: no JSON import exists, and its field names
don't match the importer anyway. The panel is literally titled **"Import &
Backup"** — "Backup" has no matching "Restore".

## Goals

1. **JSON = full-fidelity backup/restore.** A JSON export re-imports to
   reproduce the exact portfolio, including sells and their realized P&L, under
   any cost-basis method.
2. **CSV = simple, lossy, round-trippable.** A CSV export re-imports cleanly
   through the existing column-mapper (buy lots only).
3. Keep the holdings-page **report CSV** as an analysis artifact (unchanged
   except a correctness fix).
4. Do not duplicate the server's validation / matching / cash logic — extract it
   into a shared `commitLot` core that both `POST /api/holdings` and the restore
   endpoint call.

## Non-goals

- Backing up **manual cash / CPF / SRS** movements (`cash_transactions` with
  `lot_id = null`, `cpf_balances`). This feature is holdings-scoped.
- **True ACID atomicity** for restore. The restore runs server-side in a single
  request and validates the whole envelope before any write, but supabase-js
  cannot wrap the multi-step mutation in one DB transaction (the same
  limitation `purgeUser` lives with). A Postgres RPC that reimplements matching
  in PL/pgSQL is the only path to full atomicity and is deferred (see Risks).
- Teaching the CSV path to represent sells or lot allocations — that is the
  JSON path's job.

## Key domain findings (drive the design)

### 1. Realized allocations are already stored — export, don't reconstruct

`realized_lots` stores one row per matched buy↔sell pair, frozen at
sell-commit time, with `sell_lot_id`, `buy_lot_id`, `method`,
`matched_quantity`. The per-allocation gain math in `matchSell`
([`realized.ts`](../../../src/lib/realized.ts)) is **identical regardless of
method** — it only depends on the matched buy lot's price/fx/fees/quantity and
the sell's fields. Therefore:

- **FIFO / average** sells reproduce exactly by **replaying under their own
  method** against the restored open lots in trade-date order (matching is
  deterministic given the same lot sequence). No allocation data needed.
- **specific** sells reproduce exactly by replaying with **`cost_basis_method:
  "specific"` + the recorded `(buyLotId, matchedQuantity)` allocations**,
  with buy-lot ids remapped old→new.

Exporting `method` + allocations for every sell (cheap — one `fetchRealizedLots`
call) lets restore pick the right strategy and preserves the `method` label on
restored realized rows.

### 2. The `ON DELETE RESTRICT` bug — breaks "delete all" AND account deletion

FK cascade audit (migrations `20260721130000`, `20260721140000`):

| Column | Rule |
|---|---|
| `realized_lots.sell_lot_id → lots(id)` | `ON DELETE CASCADE` |
| `realized_lots.buy_lot_id → lots(id)`  | **`ON DELETE RESTRICT`** |
| `cash_transactions.lot_id → lots(id)`  | `ON DELETE CASCADE` |

Any `DELETE FROM lots WHERE user_id = …` that hits a buy lot referenced by a
realized row **fails the whole statement**: `buy_lot_id` is **RESTRICT**
(checked immediately, not deferred to end-of-statement like NO ACTION), so the
sell-side CASCADE never gets a chance to clear the referencing row first. Two
live code paths are broken for any account that has ever recorded a sale:

1. **`deleteAllLotsForUser`** — behind `DELETE /api/holdings?all=1` ("delete
   all"), and what Replace-restore will call.
2. **`purgeUser`** (`delete-user.ts`) — its `USER_SCOPED_TABLES` list omits
   `realized_lots` entirely **and** deletes `lots` first. So account deletion
   (admin *and* self-service) fails for sellers, and realized rows would be
   orphaned even if it didn't.

**Fix (both in scope):** delete `realized_lots` for the user **before** `lots`.
Auto-`cash_transactions` then cascade away; manual cash (`lot_id = null`)
correctly survives.

- `deleteAllLotsForUser`: delete own `realized_lots`, then `lots`. RLS policy
  *"Users can manage own realized lots"* (FOR ALL) lets the user-scoped client
  do this — no admin client needed.
- `purgeUser`: add `"realized_lots"` to `USER_SCOPED_TABLES` **as the first
  entry** (before `lots`); it uses the service-role client, so RLS is moot.

### 3. `exchange_code` must survive the round-trip

`instruments` rows are **shared and never purged**, deduped by
`(symbol, exchange_code)`. After a Replace-wipe the shared instrument (with its
`exchange_code`) still exists. If the backup omits `exchange_code`,
`upsertInstrument` forks a duplicate `(symbol, null)` instrument — splitting the
holding from its price cache and the shared security. So `exchange_code` is a
**correctness** requirement, not cosmetic. `fetchHoldings` already selects it
via `select("*, instruments(*)")`; it just isn't mapped onto `Holding` yet.

## Architecture

Restore runs **server-side**: the client uploads the backup file, the server
validates the whole envelope, wipes (if Replace), and commits every lot through
the **same code the manual "Add Holding" path uses** — no logic is duplicated,
and there is one network round-trip instead of N.

```text
Export:  GET  /api/holdings/backup  ──► versioned envelope (lots + sells map) ──► download .json
         (panel) fetch /api/holdings ──► importer-schema CSV ──► download .csv

Import:  drop .json ─(preview parse)─► POST /api/holdings/restore {envelope, mode}
             server: parseBackup → validate all → [Replace? wipe] → commit buys (id map) → commit sells (remap) → tally
         drop .csv  ──► existing client column-mapper (unchanged)
```

### Refactor: extract a shared `commitLot` core

Today `POST /api/holdings` does everything to land one lot inline
(`upsertInstrument` → `matchSell` for sells → `seedTickerQuote` → `insertLot` →
`insertRealizedLots` → auto-cash → dividend override). Extract that body into
**`src/lib/holdings/commit-lot.ts`**:

- **`validateLotInput(input): string | null`** — the format/numeric guards
  currently inline in the route (ticker/date regex, `finiteNonNeg`, enums).
- **`commitLot(userId, input, userSettings): Promise<CommitResult>`** — the
  mutation sequence, returning the inserted `row` (with its new lot `id`) or
  throwing a typed error (`InvalidAllocationError` / `InsufficientOpenQuantityError`
  from `matchSell`, or a generic insert failure).

`POST /api/holdings` becomes a thin wrapper: `requireAuth` → `validateLotInput`
(→ 400) → `commitLot` (→ map thrown errors to 400/409/500) → 201. Behaviour is
unchanged; this is a pure extraction that also shrinks a ~250-line handler.
The restore route calls the same two functions per lot.

### New pure module: `src/lib/portfolio-io.ts`

Single source of truth for serialization; no React, no `fetch`, no DB; fully
unit-testable, usable from both client (CSV, preview) and server (restore).

- **CSV (moved from `add/page.tsx`, hardened):** `CSV_FIELD_MAP`,
  `csvHeaderKey`, `parseCsvNumber`, and a **quote-aware** `parseCsv`
  (current `split(",")` breaks on quoted commas — round-trip demands proper
  parsing). Plus `CSV_EXPORT_COLUMNS`, `toCsv(rows)` (quotes any field
  containing `, " \n`), `holdingToCsvRow(h)`.
- **JSON backup types:** `BackupEnvelope`, `BackupLot`, `SellRestore`
  (`{ method, allocations: {buyLotId, qty}[] }`).
- **`parseBackup(text): BackupEnvelope`** — JSON-parse, assert
  `schema === "portfolio-backup"` and a known `version`, assert `lots` is an
  array; throw a friendly error otherwise (rejects a bad/foreign file before
  any wipe). Runs authoritatively on the server; the client calls it too for a
  pre-upload preview count.
- **`backupLotToCommitInput(lot): LotCommitInput`** — camelCase→snake_case;
  carries `exchange_code`, `transaction_type`, `fees`, `source`,
  `dividend_yield`, `par_value`, `coupon_rate`, `maturity_date`; **drops**
  server-owned `id, userId, createdAt, updatedAt, priceRefreshedAt,
  dividendYieldAuto, prevPrice, prevPriceSource`. Produces the exact object
  `commitLot` accepts. (Lot `notes` are **not** carried — `Holding`/
  `toHoldingRow` don't expose them, so they aren't in the export; adding a
  `notes` field to the core type is out of scope.)
- **`orderLotsForRestore(lots): { buys: BackupLot[]; sells: BackupLot[] }`** —
  each sorted by `buyDate` ascending; buys always committed before sells.
- **`remapAllocations(allocations, idMap): {buyLotId, qty}[]`** — translate old
  buy-lot ids to freshly-inserted ids; an unmapped id throws (never silently
  produces an unmatchable allocation).

### Export endpoint: `GET /api/holdings/backup`

`requireAuth`, then in parallel `fetchHoldings(user.id)` and
`fetchRealizedLots(user.id)`. Assemble:

```jsonc
{
  "schema": "portfolio-backup",
  "version": 1,
  "exportedAt": "<ISO>",
  "lots": [ /* BackupLot: Holding fields (camelCase) incl. exchangeCode, keeps old id + transactionType */ ],
  "sells": {
    "<oldSellLotId>": {
      "method": "fifo" | "average" | "specific",
      "allocations": [ { "buyLotId": "<oldBuyLotId>", "qty": <matchedQuantity> } ]
    }
  }
}
```

`sells` is built by grouping realized rows by `sellLotId` (all rows for a sell
share one `method`). Every **sell** lot gets exactly one entry (`method` +
`allocations`); **buy** lots never appear in the map. `allocations` is carried
for all methods but only *consumed* on restore for `specific` (FIFO/average
replay deterministically from `method` alone). On restore, a sell missing an
entry falls back to omitting `cost_basis_method` (server uses the account
default).

### Restore endpoint: `POST /api/holdings/restore`

Body: `{ envelope: <parsed or raw JSON>, mode: "append" | "replace" }`.

1. `requireAuth`; `fetchUserSettings` once (for `commitLot`).
2. `parseBackup` (authoritative — reject bad/foreign/unknown-version here).
3. **Validate the whole envelope up front** with `validateLotInput` on every
   lot. Any static failure aborts the request with a 400 **before any write**,
   so the common bad-data case never touches the DB (and never wipes).
4. If `mode === "replace"`: `deleteAllLotsForUser(user.id)` (realized→lots, per
   Finding 2). Abort on failure.
5. `orderLotsForRestore`. Commit **buys** via `commitLot`; record
   `idMap[oldBuyLotId] = row.id`.
6. Commit **sells** via `commitLot` with `transaction_type: "sell"`,
   `cost_basis_method` from the `sells` entry, and for `specific`,
   `lot_allocations: remapAllocations(entry.allocations, idMap)`.
7. Return `{ restored, failed, errors: string[] }` (first few messages). A sell
   that fails matching is tallied, not fatal — see Error handling.

Runs entirely with the user-scoped client (RLS-safe); no admin client. Not a
single DB transaction — see Non-goals / Risks.

### Data-layer changes (`src/lib/supabase/data.ts`, `src/types/holding.ts`, `delete-user.ts`)

1. Add `exchangeCode: string | null` to `Holding`; map it in `toHoldingRow`
   from `instrument.exchange_code`.
2. Fix `deleteAllLotsForUser`: delete own `realized_lots` first, then `lots`;
   comment the RESTRICT ordering. (Keep the name; `DELETE ?all=1` and Replace
   both use it.)
3. Fix `purgeUser`: add `"realized_lots"` as the first entry of
   `USER_SCOPED_TABLES` (before `lots`).

### UI changes

- **`ImportPanel`** tabs become `CSV · JSON · PDF`.
  - **JSON tab:** dropzone (`accept=".json"`) → client `parseBackup` for a
    preview ("N buys, M sells") → **Append / Replace** radio (Replace reveals a
    text input; confirm enables only on typing `REPLACE`) → `POST
    /api/holdings/restore` with the envelope + mode → `router.refresh()` →
    result line `Restored N · M failed`. No column-mapping step (fields known).
  - Export buttons live at **panel level**, visible on CSV & JSON tabs:
    **Export JSON** (from `/api/holdings/backup`) and **Export CSV**
    (round-trippable, importer schema, **buy lots only** — see below).
- **Holdings page:** keep the report CSV; only add comma-safe quoting via
  `toCsv` (it currently does a bare `r.join(",")`).

### CSV export scope (deliberate boundary)

The round-trippable CSV export emits **buy lots only**, using exactly
`CSV_EXPORT_COLUMNS` (the importer's understood fields). The CSV column-mapper
has no concept of sells, allocations, or matching, so representing sells in CSV
would silently re-import them as buys. CSV is the simple/lossy path by design;
users who need sells and realized P&L use JSON. This is surfaced in the CSV
export's helper text.

## Testing

### `src/lib/portfolio-io.test.ts` (pure, vitest)

- **CSV round-trip:** `parseCsv(toCsv(rows))` reproduces `rows`, including names
  with commas, embedded quotes, and thousands separators in numbers.
- **`backupLotToCommitInput`:** camelCase→snake_case for every field; server-
  owned fields dropped; `exchange_code` and `transaction_type` preserved.
- **`orderLotsForRestore`:** buys precede sells; each group sorted by date.
- **`remapAllocations`:** old ids translated; an unmapped id throws.
- **`parseBackup`:** rejects wrong `schema`, unknown `version`, non-array
  `lots` with a clear error.

### `src/lib/holdings/commit-lot.test.ts` (vitest, mocked data layer)

- **`validateLotInput`:** each guard (ticker/date format, non-finite/negative
  numbers, bad enums) rejects; a clean input passes.
- **`commitLot`:** a buy inserts instrument + lot (+ auto-cash when `trackCash`);
  a `specific` sell with allocations produces the expected `matchSell` calls and
  `insertRealizedLots`; a matching failure throws the typed error. (Data-layer
  functions mocked — this covers the extraction, not Supabase.)

## Error handling & edge cases

- **Foreign / corrupt / wrong-version file:** rejected by `parseBackup` on the
  server (and in the client preview) before any write.
- **Static validation up front:** every lot is `validateLotInput`-checked before
  the Replace-wipe or any insert, so malformed data fails fast without touching
  the DB.
- **Replace failure mid-commit:** not a single transaction (see Risks). Static
  validation eliminates the common failure; a rare DB/network fault mid-insert
  can still leave a partial portfolio — the backup file stays on disk for retry.
- **Append into a populated account:** duplicates data (expected); FIFO/average
  sells may then match against pre-existing open lots and differ. Warned in the
  Append helper text; Replace is the faithful path.
- **`specific` sell whose buy lot didn't restore** (shouldn't happen from our
  own export): `commitLot` throws the matching error; counted as a failure in
  the tally and reported, never silently dropped.
- **exchange_code re-link:** passed through so `upsertInstrument` matches the
  existing shared instrument.

## Risks / future work

- **No true DB transaction.** The restore is one server request that validates
  everything before writing, but supabase-js can't wrap the multi-step mutation
  atomically (same constraint as `purgeUser`). A rare mid-commit fault leaves a
  partial portfolio; the on-disk backup makes it retryable. Full atomicity would
  require a Postgres RPC reimplementing `matchSell` in PL/pgSQL — deferred.
- **Large portfolios:** commits are sequential within the request; hundreds of
  lots mean a longer-running request. Acceptable for expected sizes; batching is
  a later optimization if needed.

## Files touched

| File | Change |
|---|---|
| `src/lib/portfolio-io.ts` | **new** — shared CSV + JSON-backup pure helpers |
| `src/lib/portfolio-io.test.ts` | **new** — round-trip & mapping tests |
| `src/lib/holdings/commit-lot.ts` | **new** — extracted `validateLotInput` + `commitLot` |
| `src/lib/holdings/commit-lot.test.ts` | **new** — extraction tests (mocked data layer) |
| `src/app/api/holdings/backup/route.ts` | **new** — `GET` versioned envelope |
| `src/app/api/holdings/restore/route.ts` | **new** — `POST` server-side restore |
| `src/app/api/holdings/route.ts` | `POST` rewritten as thin wrapper over `commit-lot` |
| `src/types/holding.ts` | add `exchangeCode` to `Holding` |
| `src/lib/supabase/data.ts` | map `exchangeCode`; fix `deleteAllLotsForUser` ordering |
| `src/lib/supabase/delete-user.ts` | add `realized_lots` (first) to `purgeUser` |
| `src/app/(dashboard)/add/page.tsx` | JSON tab + restore upload; move CSV helpers to `portfolio-io`; panel-level export buttons |
| `src/app/(dashboard)/holdings/page.tsx` | report CSV uses `toCsv` (comma-safe) |
