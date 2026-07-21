# Issues tracker

Long-lived engineering issues that aren't captured in code TODOs or a single
GitHub issue. Each entry pairs the *interim* mitigation (what's in the code
today) with the *real fix* (what to do when we have time to do it properly).

Keep entries dated. Move an entry to the "Resolved" section when the real fix
lands.

---

## Open

### <a id="pdf-parser-cve"></a>PDF parser residual CVE (pdf-parse@1 / pdfjs-dist@1.x)

**Filed:** 2026-07-06 · **Related GitHub issue:** #22

**The problem.** `pdf-parse@1.1.1` (pinned in `package.json`) bundles
`pdfjs-dist@1.x`. That pdfjs is vulnerable to **CVE-2024-4367** — a crafted
font glyph in an attacker-controlled PDF can execute arbitrary JavaScript in
the Node process during text extraction. `/api/parse-pdf` accepts user-uploaded
PDFs, so this reaches production.

**Why we haven't upgraded.** The obvious fix (`pdf-parse@^2.4.5`, which bundles
`pdfjs-dist@5.x` with the CVE patched) is a hard break:

- v2 exposes a `PDFParse` class, not a default function — every call site
  changes.
- v2's `getText` reformats output with line thresholds and cell separators.
  The FSMOne (`src/lib/pdf-parsers/fsmone.ts`) and DBS Vickers
  (`src/lib/pdf-parsers/dbs-vickers.ts`) regex parsers depend on v1's raw
  whitespace/line layout and stop matching under v2.

Migrating naively broke statement import. We rolled back.

**What's in place today (interim mitigation, `src/app/api/parse-pdf/route.ts`).**

- Auth + rate limit (5 req/60s, fail-closed).
- 10 MB size cap.
- `.pdf` extension check.
- MIME check on the multipart part (rejects anything not
  `application/pdf` / `application/octet-stream` / `text/html`).
- Full `%PDF-x.y` header sniff (not just the 4-byte prefix) on the first
  1 KB.
- Early `/Encrypt` sniff — encrypted PDFs rejected before reaching the parser.
- `max: 200` page cap passed to `pdf-parse`.
- 20 s hard parse timeout via `Promise.race` — a malicious PDF can't hang the
  runtime.
- Distinct error messages for timeout vs. malformed input.

**What this does NOT fix.** None of the above blocks CVE-2024-4367 itself.
The exploit lives in font glyph parsing inside pdfjs, which text extraction
walks unconditionally. A crafted PDF that survives the header/MIME/encrypt
checks (trivially achievable) can still trigger the CVE.

**Real fix — migrate to `unpdf`.**

`unpdf` (https://github.com/unjs/unpdf) is a serverless-first wrapper around
modern pdfjs (v4+, patched). It ships as ESM, has no native deps, and
`extractText` returns a plain string similar in shape to what our regex
parsers expect.

Migration plan:

1. `npm install unpdf` and remove `pdf-parse` + `@types/pdf-parse` from
   `package.json`.
2. Remove `"pdf-parse"` from `serverExternalPackages` in `next.config.ts`
   (`unpdf` is bundle-safe).
3. In `src/app/api/parse-pdf/route.ts`, replace the `pdf-parse` import with:
   ```ts
   const { extractText, getDocumentProxy } = await import("unpdf");
   const pdf = await getDocumentProxy(new Uint8Array(buffer));
   const { text } = await extractText(pdf, { mergePages: true });
   ```
   Keep the size/MIME/header/timeout guards — they're still worth having.
4. **The regression risk lives here.** Run every fixture broker statement
   we have (FSMOne ETF confirmation, FSMOne consolidated statement, DBS
   Vickers monthly holdings, DBS dividend advice) through the new parser
   and diff the extracted text against v1 output. Expect differences in:
   - Trailing whitespace at line ends.
   - Line breaks between text runs on the same visual line.
   - Column separation on tabular pages.
5. Adjust the regexes in `fsmone.ts` / `dbs-vickers.ts` for whatever the
   diff reveals. The parsers are already lenient about whitespace (`\s+`
   between tokens), so most of the change should be localized.
6. Delete the ⚠️ security comment block from `route.ts` and this tracker
   entry.

**Effort estimate.** Half a day of parser tuning if we have representative
fixture PDFs on hand; a day if we're chasing edge cases in DBS Vickers'
column layout.

**Alternatives considered.**

- *Sandbox pdf-parse@1 in a `worker_threads` worker with a memory limit.*
  Isolates blast radius (RCE in the worker doesn't touch the main process),
  but it's ~200 lines of infra for a partial mitigation. Rejected in favor of
  going straight to unpdf.
- *Pin pdfjs-dist directly and monkey-patch pdf-parse.* Fragile; pdf-parse@1
  is unmaintained and any patch would depend on the exact bundled file
  layout.

---

## Resolved

*(none yet)*
