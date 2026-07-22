# Daily Auto-Refresh on First Visit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically refresh prices and record today's snapshot **once** on a user's first dashboard visit of the SGT day, so active users get fresh data and a daily data point without clicking a manual refresh button.

**Architecture:** The server layout (`(dashboard)/layout.tsx`) already fetches `snapshots`, so it computes a `staleToday` boolean (`isSnapshotStaleForDay` from `src/lib/dates.ts`) and threads it through `DashboardShell`. A small client component `<DailyAutoRefresh trigger={staleToday} />`, mounted once in the shell, fires `refreshHoldingPrices()` a single time (ref-guarded) then calls `router.refresh()`. Because `/api/holdings/refresh` records today's snapshot unconditionally and dating is SGT (T10), the re-run layout recomputes `staleToday = false`, so it never loops.

**Tech Stack:** TypeScript strict, React 19 client component, Next.js 16 App Router, Vitest 3.

## Global Constraints

- TypeScript strict mode — `npx tsc --noEmit` clean after each task.
- **Depends on T10 landing first.** This plan imports `isSnapshotStaleForDay`/`sgtDate` from `src/lib/dates.ts` and relies on `recordSnapshot` being SGT-dated — both delivered by `docs/superpowers/plans/2026-07-22-t10-history-correctness-scheduled-snapshots.md` (Tasks 1 and 3). Do not start this plan until those two tasks are merged, or the boundary mismatch this feature exists to avoid will reappear.
- **No backend changes.** `/api/holdings/refresh`, `refreshHoldingPrices()`, and the three manual refresh buttons are untouched.
- **Silent by default** — no success toast (that's the manual buttons' job); swallow errors (best-effort, matching the app's provider-fetch posture).
- Snapshots stay holdings-only; this plan only *triggers* the existing refresh, it doesn't change what a snapshot contains.

---

### Task 1: Compute and thread `staleToday`

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`
- Modify: `src/components/DashboardShell.tsx` (props interface + destructure + pass-through)

**Interfaces:**
- Consumes: `isSnapshotStaleForDay` (`@/lib/dates`, from the T10 plan); `snapshots: SnapshotRow[]` (already fetched in the layout, sorted ascending by `recordedDate`).
- Produces: a new `staleToday: boolean` prop on `DashboardShell`, consumed by Task 2.

- [ ] **Step 1: Compute `staleToday` in the layout**

In `src/app/(dashboard)/layout.tsx`, add the import near the other `@/lib` imports:
```ts
import { isSnapshotStaleForDay } from "@/lib/dates";
```
Then, after the derived-data block (just before the `return (`), add:
```ts
  // snapshots is sorted ascending by recorded_date (fetchSnapshots), so the
  // last row is the most recent. Stale when there's no snapshot for today (SGT).
  const staleToday =
    !!user &&
    isSnapshotStaleForDay(snapshots[snapshots.length - 1]?.recordedDate);
```
Add the prop to the `<DashboardShell ...>` element (alongside the existing props):
```tsx
      staleToday={staleToday}
```

- [ ] **Step 2: Accept the prop in `DashboardShell`**

In `src/components/DashboardShell.tsx`, add to the `DashboardShellProps` interface (after `initialTrackCash: boolean;`):
```ts
  staleToday: boolean;
```
Add `staleToday,` to the destructured parameter list in the function signature (alongside `initialTrackCash,`).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `dates.ts` doesn't exist yet, T10 Task 1 hasn't been merged — stop and merge it first, per Global Constraints.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds. `staleToday` is computed and passed but not yet consumed — that's fine; no behaviour change yet.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/layout.tsx src/components/DashboardShell.tsx
git commit -m "feat(dashboard): compute and thread staleToday first-visit signal"
```

---

### Task 2: `DailyAutoRefresh` client component

**Files:**
- Create: `src/components/DailyAutoRefresh.tsx`
- Modify: `src/components/DashboardShell.tsx` (import + mount once)

**Interfaces:**
- Consumes: `refreshHoldingPrices` (`@/lib/api-client`, existing); `useRouter` (`next/navigation`); the `staleToday` prop from Task 1.
- Produces: `DailyAutoRefresh({ trigger }: { trigger: boolean }): null` — a render-null side-effect component.

- [ ] **Step 1: Write the component**

Create `src/components/DailyAutoRefresh.tsx`:
```tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshHoldingPrices } from "@/lib/api-client";

// Fires the manual-refresh endpoint once, silently, on the first visit of the
// SGT day (trigger = no snapshot recorded today). The ref guards against React
// StrictMode's double-invoke and any re-render; after router.refresh() the
// server layout recomputes trigger=false, so this never loops.
export function DailyAutoRefresh({ trigger }: { trigger: boolean }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (!trigger || fired.current) return;
    fired.current = true;
    refreshHoldingPrices()
      .then(() => router.refresh())
      .catch(() => {
        // Best-effort: the manual refresh buttons remain available.
      });
  }, [trigger, router]);

  return null;
}
```

- [ ] **Step 2: Mount it once in `DashboardShell`**

In `src/components/DashboardShell.tsx`, add the import:
```ts
import { DailyAutoRefresh } from "@/components/DailyAutoRefresh";
```
Render it as the first child inside the outer flex column (immediately after the opening `<div className="flex min-h-screen flex-col">`, currently line 97):
```tsx
      <div className="flex min-h-screen flex-col">
        <DailyAutoRefresh trigger={staleToday} />
        <NerveBar
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Start `npm run dev` and log in with an account that has holdings (ensure T10 is merged so refresh records SGT-dated snapshots):
- **First load of the day:** with no snapshot yet for today (SGT), the network tab shows one `POST /api/holdings/refresh`, followed by the layout re-rendering with fresh figures. Confirm exactly **one** refresh call (StrictMode dev double-mounts the component but the ref guard must keep it to one).
- **Navigate between tabs** (Overview → Holdings → Charts): **no** further `/api/holdings/refresh` calls (the shell doesn't remount; `staleToday` is now false).
- **Reload the page** after the snapshot exists: **no** auto-refresh call (server computes `staleToday = false`).
- **Manual button** still works and still toasts, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/DailyAutoRefresh.tsx src/components/DashboardShell.tsx
git commit -m "feat(dashboard): auto-refresh once on first visit of the SGT day"
```

---

## Self-Review

**Spec coverage:**
- §Trigger signal (`staleToday` = no snapshot for today SGT, server-authoritative) → Task 1. ✅
- §Depends on SGT-dated snapshots / `isSnapshotStaleForDay` in `dates.ts` → Global Constraints + Task 1 (helper delivered by T10 plan Tasks 1 & 3). ✅
- §Client execution (dedicated component, ref-guarded fire-once, `router.refresh()`, silent, swallow errors) → Task 2. ✅
- §Why a dedicated component → realized as `DailyAutoRefresh.tsx` (Task 2). ✅
- §No backend changes → Global Constraints; no route/api-client edits in either task. ✅
- §Testing (SGT boundary of the pure comparison) → covered by `isSnapshotStaleForDay` unit tests in the T10 plan (Task 1); the fire-once ref behaviour is manual (Task 2 Step 5), as the spec states. ✅
- §Interaction with cron (this fills today only; gaps stay the cron's job) → no multi-day logic added here. ✅

**Placeholder scan:** No TBD/TODO. Both tasks show complete code. The only non-automated verification is Task 2's fire-once behaviour, which the spec explicitly assigns to manual checking.

**Type consistency:** `staleToday: boolean` defined in Task 1 (layout + `DashboardShellProps`) is the exact prop consumed by `<DailyAutoRefresh trigger={staleToday} />` in Task 2; `DailyAutoRefresh`'s `{ trigger: boolean }` matches. `isSnapshotStaleForDay(latestRecordedDate?: string, now?: Date)` is called with a single `string | undefined` argument, matching its signature in the T10 plan.

**Cross-plan dependency (flagged, not a blocker):** `src/lib/dates.ts` and SGT-dated `recordSnapshot` must be merged from the T10 plan before Task 1's `tsc` will pass. This is stated in Global Constraints and re-checked in Task 1 Step 3.
