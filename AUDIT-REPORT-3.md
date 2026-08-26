# Admin dashboard rebuild audit

Scope: `git diff 4f11600^..HEAD` only (15 files, commits `4f11600` and
`9453ce0`). This report does not repeat the whole-repository audit in
`AUDIT-REPORT.md`.

## Verdict

The rebuild is directionally strong, but three dashboard numbers are not yet
trustworthy. The Batch API discount is keyed to a value the pipeline no longer
stores, the quarantine tile is currently 33 when the check-equivalent count is
24, and engine health can hide a category that individually breached the
publication limit. I found no critical security issue and no email-address leak
through the new signup telemetry.

| Rank | Severity | Finding | Can show a wrong dashboard number? |
|---:|:---:|---|:---:|
| 1 | High | Batch extraction is always priced at full rate | Yes |
| 2 | High | The quarantine KPI applies the wrong denominator and currently overcounts 33 vs 24 | Yes, now |
| 3 | High | Engine health merges categories although the publication check is per category | Yes |
| 4 | Medium | “Per answer” divides by attempts, including errors and refusals | Yes, now |
| 5 | Medium | `loadAllRuns()` silently turns corrupt or misplaced records into lower totals | Yes |
| 6 | Medium | “Signups” is unauthenticated browser telemetry, not a verified signup count | Yes |
| 7 | Medium | Historical spend is repriced with the current rate file | Yes, after a rate change |
| 8 | Medium | The rebuilt page has no level-one heading | No |
| 9 | Medium | New masthead and zone text fails WCAG AA contrast | No |
| 10 | Low | Python and JavaScript use different tie-breaking when rounding totals | At a $0.0001 edge |
| 11 | Low | The dynamic page repeatedly reads and prices the same growing archive | No |
| 12 | Low | The diff leaves dead code and stale implementation claims | No |

## Detailed findings

### 1. High — the Batch API discount branch cannot match a real new run

**Location:** `lib/metrics.ts:549-551`, `src/unprompted/cost.py:68-70`,
`tests/agreement.test.mjs:171-210`; supporting producer evidence at
`src/unprompted/run.py:185-194` and registry evidence at `providers.json:29-35`.

**What breaks:** Both cost implementations apply the 0.5 discount only when
`run.extractor === "api"`. The pipeline explicitly stores `extractor.id`, and
the hosted Batch extractor's ID is `claude-api-extract`. A normal future API
run therefore prices extraction tokens at full list price. Its extraction line,
last-run total, per-answer amount, and archive total will all be too high; the
extraction portion is doubled.

The agreement suite cannot catch this semantic error because both languages
contain the same bad predicate. The archive currently has two runs with engine
usage, but no archived run has extraction-token usage, so the discount path is
not executed by any of the seven passing tests. The test is useful for engine
pricing and is not wholly vacuous; its Batch claim is presently untested.

**Smallest fix:** Key the discount to durable billing provenance, not the old
generic string: either store an explicit `extraction_billing: "batch" | "live" |
"subscription"` field or match the hosted extractor ID in one shared helper.
Add a synthetic run with `extractor: "claude-api-extract"` and non-zero extract
tokens, and assert the independently known half-price total—not merely
Python/TypeScript equality.

### 2. High — the quarantine KPI currently reports 33 where the check reports 24

**Location:** `app/admin/page.tsx:158-174`, `lib/data.ts:351-380`.

**What breaks:** `loadQuarantine()` merges occurrence counts from the newest
quarantine file for every category. The page then applies one threshold derived
from `board[0].totalRuns`, which is the latest *published default-category* run.
The actual check applies 2% separately to each run's answered denominator.

This is already visible in the checked-in data:

- the page uses the published coding run's 225-answer denominator, so its floor
  is 5;
- the newest coding quarantine belongs to the held 2026-08-24 run, which has
  279 answered rows and therefore a floor of 6;
- the dashboard counts 33 names as material, while applying the real per-run
  floors yields 24. Nine coding names seen exactly five times are false
  positives.

Cross-category merging can also make several individually immaterial counts
cross the threshold together.

**Smallest fix:** Preserve `{category, date, counts, answeredTotal}` through the
loader, apply the materiality rule to each category/run, and only then combine
the names for display. Add a regression fixture with different denominators and
one name split across categories.

### 3. High — category aggregation can hide an engine that breached the hold limit

**Location:** `app/admin/page.tsx:108-109,133-137`,
`lib/metrics.ts:610-628`, `tests/agreement.test.mjs:214-231`.

**What breaks:** The page collects every category whose `run_date` equals the
latest date and passes that combined array to `engineHealth()`. The publication
gate evaluates every category independently. If Claude fails 25% in one
category and 0% in another equally sized category, the dashboard reports 12.5%
and no attention state even though the first category crosses the 20% hold
line. The current test checks only that the constant is `0.2`; it does not test
the denominator or grouping.

**Smallest fix:** Compute health per run/category, make the masthead's worst
value the worst category-engine pair, and include the category in the detail.
Add a two-category masking regression test.

### 4. Medium — “per answer” includes failed and refused attempts

**Location:** `app/admin/page.tsx:111-113,208-212,502-509`.

**What breaks:** `weekAnswers` sums `r.extractions.length`, although an
extraction row may be errored or refused. The checked-in 2026-08-24 image run
has 225 rows but only 201 answers. The masthead consequently says “225 answers”
and divides cost by 225, while the adjacent health panel correctly says 201
answered and 24 failed. The two panels disagree about the same run.

**Smallest fix:** Sum `answered(r).length` for an answer denominator. If the
intended unit is scheduled calls, retain the present denominator and label it
“per attempt” everywhere.

### 5. Medium — the money loader silently presents incomplete totals as complete

**Location:** `lib/data.ts:95-117`, consumed at
`app/admin/page.tsx:106-127,512-520`.

**What breaks:** Invalid JSON, a failed read, and a record rejected by
`isRunRecord()` all disappear without a diagnostic. Unlike `loadHistory()`, the
new loader also does not verify that `parsed.category` and `parsed.run_date`
match the file's path. A malformed file lowers both last-week and archive spend;
a misplaced but structurally valid file can select or join the wrong “latest”
date. The page still labels the result “Every run ever recorded” and describes
it as accurate.

Keeping the admin page available is defensible; silently blessing a partial
money total is not.

**Smallest fix:** Return `{runs, errors}`. Render the valid rows, but mark every
dependent cost/health tile incomplete and attention-worthy when `errors` is
non-empty. Apply the same path-identity check as `loadHistory()`.

There is no path-traversal finding: date names are regex-constrained, file names
come from the repository directory itself, and the scan is only two levels
deep.

### 6. Medium — “Signups” can be forged at 30 events per IP per minute

**Location:** `app/api/track/route.ts:88-145`,
`app/admin/page.tsx:139-146,225-232`; throttle evidence at
`lib/rate-limit.ts:38-45,95-110`.

**What breaks:** Any unauthenticated caller can POST
`{"path":"/","event":"signup:provider"}`. The route proves neither a form
submission nor provider acceptance. The per-IP sliding window caps a simple
caller at 30 tracking requests a minute, but it fails open after an 800 ms Redis
delay/error and does not constrain distributed traffic. The raw 30-day value is
therefore a best-effort browser-confirmation counter, not a verified number of
subscribers. That is tolerable for a single-operator directional metric, but
the unqualified “Signups” label overstates its authority.

**Smallest fix:** Immediately relabel it “Browser-confirmed signups.” For an
authoritative count, increment from a mailing-provider webhook; for the inbox
fallback, issue and consume a short-lived server nonce so arbitrary tracking
POSTs cannot claim success.

There is no double-count bug: `signup:tried` is a separate funnel stage and is
not added to `signup:provider`/`signup:inbox`. The contact button is correctly
distinguished because the `.subscribe-submit` branch runs before `.share-btn`
and checks `.contact-submit` (`components/beacon.tsx:56-70`). The real form path
sends analytics only a fixed label and path, not the email address
(`components/subscribe.tsx:64-69`).

### 7. Medium — the archive total is not historical spend after rates change

**Location:** `data/rates.json:2-5`, `app/admin/page.tsx:113,512-520`.

**What breaks:** Every request reprices every archived usage record with the
single current rate table. Editing `rates.json` therefore rewrites “Every run
ever recorded” even though old invoices do not change. The JSON note admits
that correction restates history, but the dashboard presents the result as an
accurate reading without saying “at current rates.”

**Smallest fix:** Stamp a rate-table version or verified date into each run and
retain immutable rate snapshots. The smaller presentational fix is to label the
aggregate “Recorded usage at current rates,” but that still does not answer
historical spend.

### 8. Medium — the rebuilt page begins at `<h2>`

**Location:** `app/admin/page.tsx:248-260`.

**What breaks:** The redesign deliberately removes the only `<h1>` and starts
the document's content hierarchy at “Operations” as an `<h2>`. Visual size is
not the issue; assistive-technology heading navigation loses a level-one page
name. This is an implementation-integrity/WCAG 1.3.1 and 2.4.6 issue.

**Smallest fix:** Add an `sr-only` `<h1>Admin dashboard</h1>` before the
masthead, preserving the visual layout.

### 9. Medium — essential new labels and notes use a low-contrast token

**Location:** `app/globals.css:954-971`, used by
`components/admin-masthead.tsx:43-45`.

**What breaks:** `--fg-3` is `#8a8a8a` on the light tile surface and `#6a6f77`
on the dark tile surface. The measured contrast is approximately 3.31:1 light
and 3.79:1 dark, below WCAG AA's 4.5:1 requirement for the new 10.5–12 px text.
These strings are not decorative: they identify each KPI and carry unique
failure, timing, and measurement caveats. The zone headings use the same token.

**Smallest fix:** Use `--fg-2` for mast labels, mast notes, and zone headings;
it measures above 7:1 on both tile surfaces. Suggested UI pass:
`$impeccable harden`.

### 10. Low — total rounding differs across languages on exact ties

**Location:** `lib/metrics.ts:584-588`, `src/unprompted/cost.py:99-100`,
`tests/agreement.test.mjs:194-210`.

**What breaks:** Python `round(..., 4)` uses ties-to-even; JavaScript
`Math.round(total * 10_000) / 10_000` rounds a positive half upward. A
mathematical total of `$0.03125` (for example, 25,000 ChatGPT input tokens at
the checked-in `$1.25/M` rate) rounds to `$0.0312` in Python and `$0.0313` in
TypeScript. Real archived totals do not currently land on such a tie, so the
agreement test passes.

**Smallest fix:** Declare one rounding rule and implement it identically with
integer/decimal arithmetic. Add exact-half fixtures; do not rely only on the
current archive corpus.

### 11. Low — each dynamic admin request reparses and reprices the archive repeatedly

**Location:** `app/admin/page.tsx:55-56,82-84,106-127`.

**What breaks:** `/admin` is dynamically server-rendered. The default category
is loaded once as `history`, again through `latestRun()`, again in the
per-category loop, and then all records are read through `loadAllRuns()`.
`costOfRun()` is separately called for weekly total, archive total, and weekly
line items. The current four run files are already 3.6 MB; a normal three-
category archive grows every week, so latency and memory rise linearly forever.

**Smallest fix:** Reuse `history.at(-1)`, parse each run once, and create one
`pricedRuns` array reused for totals and lines. The durable upgrade is a small
validated summary ledger written with each run, leaving raw answer bodies out
of the admin hot path. Suggested UI pass: `$impeccable optimize`.

### 12. Low — verified dead code and documentation drift remain in the diff

**Locations:**

- `components/admin-analytics.tsx:366-374`: local `Stat` has no caller.
- `app/admin/page.tsx:176`: `staleCategories` is computed and never read.
- `app/admin/page.tsx:2,26,150-152`: `node:fs` is imported twice under two names.
- `src/unprompted/cost.py:32`: `RATES_VERIFIED` is exported but has no caller.
- `components/admin-masthead.tsx:3-19`, `app/globals.css:940-943`, and
  `DESIGN.md:171-174`: all say the masthead has six figures; it renders eight.
- `data/rates.json:2`: names nonexistent `lib/cost.ts`; the reader is
  `lib/metrics.ts`.
- `lib/metrics.ts:549-550` and `src/unprompted/cost.py:68-69`: comments say
  `"api"` is the Batch path, contradicting the current producer and causing
  finding 1.

**What breaks:** Mostly maintenance clarity rather than runtime behavior, but
the stale Batch comment actively conceals the money defect.

**Smallest fix:** Delete the unused component/value/import/constant, update the
tile count and file reference, and replace the Batch comment with an explicit
billing-provenance contract. Finish the UI cleanup with `$impeccable polish`.

## Scoped UI health

The implementation is product-specific and visually coherent, so it passes the
implementation-integrity character test. It does not yet pass the stronger
number-integrity bar expected of an operator dashboard.

| Dimension | Score | Key finding |
|---|:---:|---|
| Accessibility | 2/4 | Missing `<h1>` and sub-AA KPI text |
| Performance | 2/4 | Dynamic full-archive parsing grows without bound |
| Responsive design | 4/4 | Masthead has explicit 4/3/2-column breakpoints and no fixed viewport width |
| Theming | 3/4 | Tokens are used consistently; `--fg-3` is the wrong semantic/contrast token here |
| Implementation integrity | 2/4 | Coherent system, but multiple displayed values do not match their stated rules |
| **Total** | **13/20 — Acceptable** | **Fix number integrity before relying on the dashboard** |

The Impeccable detector emitted one `side-tab` warning at
`app/globals.css:399`; that line predates this two-commit scope and was excluded
rather than re-reporting unrelated work.

## Positive findings

- The agreement test now imports and executes production `lib/metrics.ts`; it
  genuinely fixes the prior audit's “third implementation” problem.
- Python and TypeScript engine pricing agree on all archived usage currently
  present.
- Signup attempts and successes are separate stages, the shared button classes
  are ordered correctly, and the implemented form path does not send an email
  address to analytics.
- `/admin` is excluded in the browser beacon, the tracking route, and
  `recordRequest()`, covering humans, stale/manual beacon requests, and agents.
- The loader has no user-controlled traversal path, and the new layout uses the
  existing token system with explicit responsive breakpoints.

## Recommended order

1. Fix Batch billing provenance and add an independently expected synthetic
   cost test.
2. Compute quarantine materiality and engine health per category/run.
3. Correct the answer denominator and make loader incompleteness visible.
4. Decide whether signup telemetry is directional or authoritative and label or
   redesign it accordingly.
5. Version historical rates, then address rounding and archive-read growth.
6. Run `$impeccable harden` for the heading/contrast issues and
   `$impeccable polish` after the functional fixes.

## Verification performed

- Read the full scoped diff and every changed implementation/test file.
- `npm test`: **7/7 passed**. As finding 1 explains, no archived record executes
  the extraction-usage/Batch-discount path.
- `npx tsc --noEmit`: **passed**.
- `npm run build`: **passed** on Next.js 16.3.2; 74 static pages generated and
  `/admin` confirmed dynamic.
- `python -m pytest -q`: not run directly because the sandboxed shell could not
  resolve the user Python executable. The agreement suite did successfully run
  its production Python subprocesses.
- `tests/analytics_contract.py`: not run because no server was listening on
  port 3577. `.env.local` was present; no secret values were read.
- No live provider calls, tracking writes, signup submissions, or admin writes
  were made. No source, data, or configuration file was modified; this report is
  the only repository change.
