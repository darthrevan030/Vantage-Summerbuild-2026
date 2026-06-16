# Codebase Cleanup Report & Action Plan

**Audience:** A second-year university student doing this as a task.
**Goal:** Remove dead code, fix a few structural quirks, and reduce repeated/boilerplate code — **without changing how the app behaves.**

Read this whole document once before you touch anything. Then follow the plan section by section, in order.

---

## Part 0 — Before You Start (READ THIS)

### What this codebase is
A Next.js 16 finance dashboard. Source lives in `src/`. It talks to a Supabase database and some external finance APIs (Yahoo, Frankfurter, EODHD, Finnhub, Anthropic).

### The golden rules
1. **You are NOT adding features and NOT changing behaviour.** The app must work exactly the same after you finish. You are only deleting unused code and reorganising duplicated code.
2. **Work in small steps. Commit after every step.** If something breaks, you can undo one small step instead of losing everything.
3. **After every change, run the three checks below.** If any of them fail because of your change, fix it or undo that step before moving on.

### The three checks (run these constantly)
Open a terminal in the project root (`c:\coding_projects\summerbuild-2026`) and run:

```powershell
npx tsc --noEmit      # 1. TypeScript type check — catches broken imports/types
npm run lint          # 2. ESLint — catches unused vars, bad patterns
npm run build         # 3. Production build — the final "does it actually compile" check
```

- Check 1 (`tsc`) is the fast one — run it after almost every edit.
- Check 3 (`build`) is the slow but thorough one — run it at the end of each Phase.
- **Important:** Run these checks ONCE before you change anything, so you know the "before" state. If a check already shows a warning that has nothing to do with your work, that's not your problem — just make sure you don't make it worse.

### Git workflow (do this for safety)
```powershell
git checkout main
git pull
git checkout -b chore/cleanup-dead-code
```
Now do all your work on this branch. Commit after each numbered step with a clear message, e.g.:
```powershell
git add -A
git commit -m "chore: delete unused seed.ts"
```

### How to check if something is "used" anywhere
The whole plan relies on one skill: **searching the codebase for a name.** Use VS Code's search (press `Ctrl+Shift+F`) and type the function/file name. Or in the terminal:
```powershell
# Example: find everywhere "groupIntoPositions" is mentioned
Select-String -Path src\*,src\**\* -Pattern "groupIntoPositions"
```
If the ONLY result is the line where it's defined, it's dead. If there are other results (someone `import`s it), it's alive — leave it.

---

## Part 1 — The Findings (what's wrong)

### A. Dead code (code that is written but never used)

| # | File / Location | What it is | Evidence it's dead |
|---|---|---|---|
| 1 | `src/lib/seed.ts` (whole file) | Fake demo data + a duplicate `generatePortfolioSeries` | Nothing imports `@/lib/seed`. The real `generatePortfolioSeries` lives in `src/lib/portfolio.ts`. |
| 2 | `src/lib/positions.ts` lines ~11 and ~126 | `Position` interface, `groupIntoPositions()`, and the `aggregate()` helper | Only `NON_GROUPABLE` (line ~40) is imported elsewhere. The rest only refer to each other. |
| 3 | `src/lib/api-client.ts` line ~41 | `streamAnalysis()` function | Nothing imports it. Replaced by `streamSentiment`/`streamAsk` in `src/lib/api/client/analyst-api.ts`. |
| 4 | `src/lib/hexA.ts` line ~20 | `applyAccent()` function | No code calls it (only a comment in `globals.css` mentions it). |
| 5 | `design/` folder (10 `.jsx` files) | Old design mockups | No file in `src/` imports from `design/`. It's prototype leftovers. |

> ⚠️ **DO NOT DELETE** `buildFxColors` or `buildBaseFxRates` in `src/lib/portfolio.ts`. They look unused but they ARE used in `src/app/(dashboard)/layout.tsx`. Leave them alone.

### B. Structural quirks (things in the wrong place / duplicated constants)

| # | Problem | Where |
|---|---|---|
| 6 | Two React hooks live in `src/lib/` instead of `src/hooks/` | `src/lib/useCountUp.ts`, `src/lib/useDateRange.ts` |
| 7 | The same validation patterns are copy-pasted across many API routes | `CCY_RE = /^[A-Z]{3}$/` appears in ~6 routes; `DATE_RE` in ~3; `finiteNonNeg` defined twice |
| 8 | The same "stock symbol mapping" tables are copied between files | `EODHD_CODE_REMAP` in both `src/lib/prices.ts` and `src/app/api/holdings/backfill/route.ts` |
| 13 | A third exchange-mapping table sits in the news route | `EODHD_TO_FINNHUB` in `src/app/api/news/route.ts` maps EODHD exchange codes → Finnhub prefixes. Related to `EODHD_CODE_REMAP` but different direction. Both could move to `src/lib/provider-symbols.ts` (see Step 3.2). |
| 14 | `baseTicker()` utility duplicated in context | `src/app/api/news/route.ts` defines a local `baseTicker()` that strips the exchange suffix from dot-notation tickers. The same logic is inlined in `prices.ts` line 88. Candidate for `src/lib/provider-symbols.ts` or a small `src/lib/tickers.ts` shared util. |

### C. Boilerplate (the same logic written by hand over and over)

| # | Problem | Where |
|---|---|---|
| 9 | Every protected API route repeats the same auth check | `const { user, error } = await requireAuth(); if (error) return error;` in ~15 routes |
| 10 | Rate-limit / provider-flag guards are repeated | ~7 routes (rate limit), ~12 routes (provider flags) |
| 11 | FX history fetching is implemented twice | `fetchFxHistory` in `backfill/route.ts` duplicates `ensureFxHistory` in `src/lib/providers/fx.ts` |
| 12 | Three page files are giant (1000+ lines) mixing data + UI | `holdings/page.tsx` (1689), `add/page.tsx` (1425, grown with PDF import UI), `analysis/page.tsx` (940) |

---

## Part 2 — The Plan (what to do, in order)

The plan is split into **5 phases, easiest first**. Each phase is independently shippable. **You can stop after any phase and the work so far is still valuable.** If you run low on time, doing Phases 1–3 well is much better than doing all 5 badly.

> **For every single step:** make the change → run `npx tsc --noEmit` → if clean, `git commit`. Repeat.

---

### PHASE 1 — Delete dead code (Easiest. ~1 hour. Start here.)

This phase only DELETES things. The risk is low because we verify each item is unused first.

**Step 1.1 — Delete `seed.ts`**
1. Search the whole project for `lib/seed`. Confirm there are **zero** import results.
2. Delete the file `src/lib/seed.ts`.
3. Run `npx tsc --noEmit`. It should be clean.
4. Commit: `chore: remove unused seed.ts`.

**Step 1.2 — Remove dead exports from `positions.ts`**
1. Open `src/lib/positions.ts`.
2. Search the project for `groupIntoPositions`. Confirm the only result is its definition. Delete the `groupIntoPositions` function.
3. Search the project for `Position` used as `from "@/lib/positions"`. The `Position` interface is only used inside this file by the now-deleted function and the `aggregate` helper. Delete the `Position` interface and the `aggregate` helper too.
4. **KEEP** `NON_GROUPABLE` — it's imported by `group-holdings.ts`.
5. Run `npx tsc --noEmit`. Fix any leftover unused-import lines it complains about (delete the orphaned imports at the top of the file).
6. Commit: `chore: remove unused exports from positions.ts`.

**Step 1.3 — Delete `streamAnalysis`**
1. Search the project for `streamAnalysis`. Confirm the only results are inside `src/lib/api-client.ts`.
2. Delete only the `streamAnalysis` function from that file. **KEEP** `fetchFx` and `refreshHoldingPrices` (those are used).
3. Run `npx tsc --noEmit`. Commit: `chore: remove unused streamAnalysis`.

**Step 1.4 — Delete `applyAccent`**
1. Search the project for `applyAccent`. Confirm no real code calls it.
2. In `src/lib/hexA.ts`, delete the `applyAccent` function. If the small `hexA` helper it used is now also unused, delete that too (re-check with a search). If `hexA` is still used elsewhere, keep it.
3. Run `npx tsc --noEmit`. Commit: `chore: remove unused applyAccent`.

**Step 1.5 — Move the `design/` mockups out of the source tree**
1. These are old design files, not part of the app. Don't just delete blindly — they may be useful reference.
2. Create a folder `docs/design-mockups/` and move all of `design/*.jsx` into it. (Or, if your supervisor confirms they're not needed, delete the `design/` folder.)
3. Run `npm run build` to confirm nothing referenced them. Commit: `chore: move design mockups to docs/`.

**End of Phase 1:** Run all three checks (`tsc`, `lint`, `build`). All should pass. You've removed ~500 lines of dead code.

---

### PHASE 2 — Tidy structure (Easy. ~1 hour.)

**Step 2.1 — Move the two stray hooks into `src/hooks/`**
1. Move `src/lib/useCountUp.ts` → `src/hooks/useCountUp.ts`.
2. Move `src/lib/useDateRange.ts` → `src/hooks/useDateRange.ts`.
3. Now fix the imports. Search the project for `lib/useCountUp` and `lib/useDateRange`. For each result (e.g. in `fx-lab/page.tsx` and `charts/page.tsx`), change the import path from `@/lib/useCountUp` to `@/hooks/useCountUp`.
4. Run `npx tsc --noEmit`. It will error on any import you missed — fix those. Commit: `refactor: move hooks from lib to hooks folder`.

> Tip: in VS Code, if you drag-and-drop the file in the Explorer, it offers to update imports automatically. Do that, then run `tsc` to be sure.

---

### PHASE 3 — Centralise duplicated constants (Easy–Medium. ~2 hours.)

The idea: create ONE file that holds a shared thing, then make every copy point to that file and delete the copies.

**Step 3.1 — Create `src/lib/validators.ts`**
1. Create a new file `src/lib/validators.ts` with this content:
   ```ts
   // Shared validation regexes and helpers used across API routes.
   export const CCY_RE = /^[A-Z]{3}$/;            // currency code, e.g. "SGD"
   export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;  // ISO date, e.g. "2026-06-16"
   export const TICKER_RE = /^[A-Za-z0-9.\-:]{1,20}$/;

   /** True if v is a finite number >= 0 and <= max. */
   export const finiteNonNeg = (v: unknown, max = 1e12) => {
     const n = Number(v);
     return Number.isFinite(n) && n >= 0 && n <= max;
   };
   ```
   > ⚠️ Before saving, open one of the existing routes (e.g. `src/app/api/cpf/route.ts`) and copy the EXACT regex/values they use, so the shared versions match. Don't guess.
2. Now go route by route. For each API route under `src/app/api/` that defines its own `CCY_RE`, `DATE_RE`, `TICKER_RE`, or `finiteNonNeg`:
   - Delete the local definition.
   - Add an import at the top: `import { CCY_RE, finiteNonNeg } from "@/lib/validators";` (only import the ones that file actually uses).
3. Do ONE route, run `npx tsc --noEmit`, confirm clean, then move to the next. Commit after every 2–3 routes.
4. To find them all, search the project for `CCY_RE`, `DATE_RE`, `TICKER_RE`, and `finiteNonNeg`.

**Step 3.2 — Create `src/lib/provider-symbols.ts`**
1. Look at the symbol-mapping constants in `src/lib/prices.ts` (e.g. `EODHD_CODE_REMAP`) and the copy in `src/app/api/holdings/backfill/route.ts`.
2. Confirm the duplicated one (`EODHD_CODE_REMAP`) is identical in both files.
3. Move it into a new `src/lib/provider-symbols.ts` and `export` it.
4. In BOTH `prices.ts` and `backfill/route.ts`, delete the local copy and import it from `@/lib/provider-symbols`.
5. Run `npx tsc --noEmit`. Commit: `refactor: centralise provider symbol maps`.

> Only move constants that are **genuinely identical**. If two maps look similar but have different keys, leave them separate — they're not actually duplicates.

---

### PHASE 4 — Reduce API route boilerplate (Medium. ~half a day.)

This is the highest-value refactor. We make small "wrapper" functions so routes stop repeating guard code. **Do Step 4.1 fully and make sure it works before attempting 4.2/4.3.**

**Step 4.1 — Create a `withAuth` wrapper**
1. First, open 3–4 routes (e.g. `cash`, `cpf`, `settings`) and look at how they currently start. Most look like:
   ```ts
   export async function GET(req: NextRequest) {
     const { user, error } = await requireAuth();
     if (error) return error;
     // ... real logic using `user`
   }
   ```
2. Create `src/lib/api/server/with-auth.ts`:
   ```ts
   import type { NextRequest } from "next/server";
   import { requireAuth } from "@/lib/supabase/guards"; // <-- check the real path to requireAuth first!

   type AuthedHandler = (
     req: NextRequest,
     ctx: { user: Awaited<ReturnType<typeof requireAuth>>["user"]; params?: unknown },
   ) => Promise<Response>;

   export function withAuth(handler: AuthedHandler) {
     return async (req: NextRequest, routeCtx?: { params?: unknown }) => {
       const { user, error } = await requireAuth();
       if (error) return error;
       return handler(req, { user, params: routeCtx?.params });
     };
   }
   ```
   > Find where `requireAuth` is actually defined (search the project) and use that exact import path.
3. Convert ONE simple route first (e.g. `src/app/api/cash/route.ts`) to use it:
   ```ts
   export const GET = withAuth(async (req, { user }) => {
     // ... the same logic, but delete the requireAuth lines
   });
   ```
4. **Test that route in the running app** (`npm run dev`, log in, open the page that calls it). Confirm it still works exactly as before. This is critical — auth bugs are serious.
5. Once you're confident, convert the other simple authed routes one at a time. Commit after each. If a route does something unusual, skip it — don't force it.

**Step 4.2 — (Optional) `withRateLimit` and `withProvider` wrappers**
Same idea as 4.1, for the rate-limit check (`enforceRateLimit`) and the provider-flag check (`getProviderFlags`). Only attempt this after 4.1 is done and working. These wrappers should be *composable* with `withAuth`. If this feels too advanced, **skip it** — it's a nice-to-have.

**Step 4.3 — De-duplicate FX history fetching**
1. Compare `fetchFxHistory` in `src/app/api/holdings/backfill/route.ts` with `ensureFxHistory` in `src/lib/providers/fx.ts`.
2. If they do the same job, change `backfill/route.ts` to call the provider's function and delete its local copy.
3. **Test the backfill route in the running app** before committing — confirm the chart/history data still loads.

---

### PHASE 5 — Split the giant page files (Hard. Do last, one page at a time.)

⚠️ **This is the riskiest phase. Only start it once Phases 1–4 are committed and the app is verified working.** If you run out of time, it is completely fine to leave this phase undone.

The goal: take a 1000+ line page and move chunks of its UI into separate component files. **You are cutting and pasting, NOT rewriting.** The behaviour must not change.

**General technique for extracting a component:**
1. Find a self-contained chunk of JSX inside the page (e.g. the `DetailCard` block in `holdings/page.tsx`).
2. Create a new file, e.g. `src/components/HoldingDetail.tsx`.
3. Cut the chunk into the new file as its own component. Figure out what data it needs — those become **props**.
4. In the page, import the new component and render it, passing the props.
5. Run `npx tsc --noEmit` (it tells you exactly which props/types are missing) and fix until clean.
6. **Run the app and click through that page** to confirm it looks and behaves identically.
7. Commit. Then extract the next chunk.

**Suggested order (do them as separate commits, smallest pieces first):**

1. **`analysis/page.tsx`** (do this page first — it's the easiest):
   - Move the pure helper functions (`hashStr`, `sentPath`, `sampleTo`, `sparkToSentPath`, `clamp`, `mean`) into a new `src/lib/sentiment.ts` and import them back. (Pure functions are the safest thing to move.)
   - Then extract the `MiniSpark` and `SentDrawer` JSX blocks into `src/components/`.

2. **`add/page.tsx`**:
   - Extract each form into its own file: `CpfBalanceForm.tsx`, `CashBalanceForm.tsx`, `ImportPanel.tsx`, `ManualHoldingForm.tsx`. Each takes an `onSuccess` callback prop.

3. **`holdings/page.tsx`** (do this last — it's the biggest):
   - Extract `DetailCard` → `src/components/HoldingDetail.tsx` first (it's the largest single block, ~600 lines).
   - Then extract the filter bar and the table-row rendering.

> **Rule for Phase 5:** one extraction = one commit. Never extract two components in one go. If `tsc` shows 20 errors after an extraction, you cut too much or missed a prop — undo (`git checkout .`) and try a smaller chunk.

---

## Part 3 — Definition of Done (how you know you've finished)

For the phases you complete, ALL of these must be true:

- [ ] `npx tsc --noEmit` passes with no new errors.
- [ ] `npm run lint` passes with no new errors.
- [ ] `npm run build` completes successfully.
- [ ] You ran the app with `npm run dev`, logged in, and clicked through **every page you touched** (Overview, Holdings, Add, Analysis, Charts, Admin). Everything looks and works the same as before.
- [ ] Every change is a small, clearly-described commit on the `chore/cleanup-dead-code` branch.
- [ ] No behaviour changed. No features added or removed.

When done, push the branch and open a Pull Request that lists which phases you completed.

---

## Part 4 — If You Get Stuck

- **"`tsc` shows an error I don't understand."** Read the file and line number it gives you. Usually it's a missing import or a wrong prop type. If you can't fix it in 10 minutes, `git checkout .` to undo the current uncommitted step and try a smaller change.
- **"Is this code actually used?"** Search the whole project for its name. Only the definition line = dead. Any `import` of it = alive.
- **"The app broke when running `npm run dev`."** Look at the browser console and the terminal for the error. It points to a file and line. If it's from your last change, undo that change.
- **Golden escape hatch:** `git stash` saves your uncommitted mess so you can get back to a clean state, look around, then `git stash pop` to bring it back.

**When in doubt, do less.** A smaller, correct change committed is worth more than a big risky one.
