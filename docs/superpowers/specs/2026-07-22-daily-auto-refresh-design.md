# Daily Auto-Refresh on First Visit (Design)

**Status:** Approved · **Date:** 2026-07-22 · **Backlog ref:** serves T10's "accrue automatically instead of only when a user manually triggers it" goal from the client side.
**Companion spec:** `2026-07-22-t10-history-correctness-scheduled-snapshots-design.md` (server-side cron — the inactive-user counterpart to this spec).

## Problem

Price refresh is **entirely manual**. Three buttons — in `TabBar`, `NerveBar`, and `holdings/page.tsx` — call `refreshHoldingPrices()` → `POST /api/holdings/refresh`, which refreshes stale quotes and records today's snapshot. Nothing refreshes automatically on load. So an active user who never clicks refresh on a given day gets stale prices in the UI and **no snapshot for that day**, leaving a hole in the value series that T8's returns math depends on.

The T10 cron closes this for *inactive* users (a daily server-side snapshot). This spec closes it for *active* users: refresh once automatically on their first visit of the day, no click required. The two are complementary — the cron uses cached quotes and may lag intraday; a visiting user should see genuinely fresh prices and get an immediate same-day data point.

## Trigger signal: server-authoritative, once per day

The dashboard layout (`src/app/(dashboard)/layout.tsx`) already fetches `snapshots`. It computes a boolean:

```
staleToday = latestSnapshot?.recordedDate !== todaySGT
```

where `todaySGT = sgtDate()` is today's date in the `Asia/Singapore` timezone (the app is SGD-base / SGX-oriented), and `latestSnapshot` is the most recent row in the already-fetched `snapshots`. If the user has no snapshots at all, `staleToday` is `true`.

**Depends on SGT-dated snapshots (T10).** This signal is only correct if `recordSnapshot` also dates rows in SGT. The T10 spec introduces the shared `sgtDate(d?: Date): string` helper (`src/lib/dates.ts`) and switches `recordSnapshot` from UTC to `sgtDate()` precisely so the recorded date and this comparison agree; without it, a refresh between 00:00–08:00 SGT would write a previous-UTC-day row that never matches `todaySGT`, re-firing the auto-refresh every fresh page load. So **T10 must land first** (or its `dates.ts` + `recordSnapshot` change must be included). The comparison is extracted as a small pure helper `isSnapshotStaleForDay(latestRecordedDate: string | undefined, now: Date): boolean` in `src/lib/dates.ts` for unit-testing.

**Why "no snapshot for today" and not quote-staleness.** `isStale` in the refresh route uses a 5-minute window — reusing it would fire the auto-refresh on nearly every visit, which is "refresh whenever stale," not "first visit of the day." The snapshot date is the correct once-per-day signal: `POST /api/holdings/refresh` records today's snapshot **unconditionally** (even when prices are already fresh), so the first auto-refresh flips `staleToday` to `false` for the rest of the SGT day. Server-authoritative state also makes this **multi-device-correct** — a refresh on the phone suppresses the auto-refresh on the laptop, with no per-device `localStorage` bookkeeping.

## Client execution

`staleToday` is threaded through `DashboardShell` (already a client component) as a new prop, which renders a small dedicated client component:

```
<DailyAutoRefresh trigger={staleToday} />
```

Behaviour:
- On mount, if `trigger` is `true` **and** a `useRef` guard has not already fired this component instance, call `refreshHoldingPrices()`, then `router.refresh()` to re-run the server layout and pull the fresh holdings + the new snapshot.
- The `useRef` guard prevents a double-fire from React StrictMode's development double-invoke and from the render that follows `router.refresh()`. After `router.refresh()`, the re-run layout computes `staleToday = false` (today's snapshot now exists), so a remount is inert regardless.
- **Silent by default:** no success toast (unlike the manual buttons). Optionally a subtle, non-blocking "updating prices…" indicator in the `NerveBar` while the request is in flight; failures are swallowed (best-effort, same posture as the existing provider fetches) — the manual buttons remain the explicit path.

## Why a dedicated component (not an effect in DashboardShell)

Keeping the fire-once logic in its own component gives it a single clear purpose (own the daily-refresh side effect and its guard ref), keeps `DashboardShell` free of unrelated effect wiring, and makes the behaviour unit-reasonable in isolation. It depends only on its `trigger` prop and `useRouter`.

## Backend

**No backend changes.** `/api/holdings/refresh` is reused exactly as-is — already rate-limited (12/60s), already `isStale`-gated so fresh quotes aren't re-fetched, and (via the T10 `recordSnapshot` net-position fix) it now records a **correct** holdings-only snapshot. This spec is purely the automatic client trigger plus the server-computed `staleToday` flag.

## Interaction with the T10 cron

- **This spec** records **today** for a visiting user, with genuinely fresh prices.
- **The cron** records **all missing days** for every active user (including those who never visit), from cached quotes.
- A user returning after a multi-day absence gets *today* filled immediately by this feature; the intervening days are filled by the next cron run (and read-side fill-forward bridges the gap visually until then). This feature does **not** trigger a multi-day backfill — that stays the cron's responsibility, keeping the first-visit path a single cheap request.

## Data flow summary

- Changed: `layout.tsx` computes `staleToday` (todaySGT vs latest snapshot date) and passes it to `DashboardShell`.
- Changed: `DashboardShell` accepts a `staleToday: boolean` prop and renders `<DailyAutoRefresh>`.
- New: `src/components/DailyAutoRefresh.tsx` (client; `refreshHoldingPrices()` + `router.refresh()`, ref-guarded).
- Unchanged: `/api/holdings/refresh`, `refreshHoldingPrices()` in `api-client.ts`, the three manual buttons.

## Testing

The logic worth isolating is the SGT "today" comparison — extract it as a small pure helper (e.g. `isSnapshotStaleForDay(latestRecordedDate, nowUtc)`) and unit-test it: same SGT day → not stale; snapshot from yesterday SGT → stale; the UTC-vs-SGT boundary case (a late-UTC-evening visit that is already "tomorrow" in SGT) resolves to the SGT day; no snapshots → stale. The component's fire-once ref behaviour is covered by manual verification (first load refreshes; tab navigation does not re-fire).

## Explicitly out of scope

- Multi-day backfill from the client (the cron owns that).
- A configurable refresh cadence or per-user auto-refresh toggle.
- Changing the manual refresh buttons or their toasts.
- Intraday auto-refresh (this is once per SGT day, tied to the snapshot signal).
