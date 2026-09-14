# Unprompted: systematic audit and implementation report

Date: 2026-09-14. Audited local HEAD: `5dbcabce5e8dac711678f40e64991a32e3438590`.

**The architecture is appropriate; the next investment should be trustworthy recovery, accounting, and evidence navigation. A rewrite is unnecessary.** The most urgent change is patching vulnerable dependencies. The next priorities are closing a published-record overwrite path, preserving paid answers before extraction, and fixing operational numbers that currently omit or discard evidence.

This is an audit and a proposed implementation plan, not a claim that the proposed fixes have shipped. Application code, configuration, published data, and dependency versions were not changed. This deliverable adds offline reproductions, their results, and a tracked-file hash manifest. No model calls, newsletter submissions, GitHub issues, commits, pushes, or deployments were performed.

## Scope and evidence

The audit follows configuration → scheduling → engine queries → extraction → normalization → publication checks → persistence → reports → website/distribution, plus admin editing, analytics, vault archival, CI, and notifications. It also reviews authentication, dependency advisories, public UX, token use, and maintainability.

The manifest covers **210 tracked files, 10,612,446 bytes**. This population includes project documentation and bundled skill material; the manifest is an inventory and integrity record, not a claim that every dependency or guidance file received a line-by-line security review. First-party execution paths and their callers were reviewed. All **nine stored run records / 2,625 extraction rows** were inventoried. Existing audits were considered as leads and checked against current code, not accepted as current findings automatically.

Evidence labels:

- **CONFIRMED:** directly established by source, an offline reproduction, installed-package scan, or the observed public UI. Source-confirmed conditions do not imply they have occurred in production.
- **PROBABLE:** supported failure mechanism or improvement whose frequency or magnitude needs runtime measurement.
- **UNVERIFIED:** requires provider accounts, deployed infrastructure, user testing, or a live acceptance run.

| Validation | Result and limit |
|---|---|
| `python -m pytest tests/test_pipeline.py -q` | 126 passed, 8.56 seconds |
| `npm test` | 12 passed; actual Python/TypeScript metric agreement exercised |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, 74 generated pages; local build only |
| `npm audit --omit=dev --json` | Two vulnerable packages: Next critical, Sharp high |
| `python audit/2026-09-14/reproduce.py` | Nine current defects reproduced offline in temporary directories |
| `node audit/2026-09-14/metrics-probes.mjs` | Three statistical presentation defects reproduced |
| Impeccable detector over `app components` | Two warnings; neither warrants changing the established design |
| Browser inspection | Public homepage and image-generator chart; desktop, 390px homepage, dark/light theme state |

The local server launch was rejected by automatic approval review as “blocked by policy,” without a more specific reason. Browser evidence therefore comes from **the deployed public site**, not the local build. Its deployed commit was not established. The mobile DOM reported a 390px viewport, 375px document width, and a hidden question readout. Theme switching produced a white body and the expected light metadata token; viewport and original dark theme were restored.

No authenticated admin mutation or live API integration was tested. The Redis integration script was deliberately not executed because it deletes operational keys from credentials loaded out of `.env.local` (F13). Windows task registration, GitHub workflow activation, production deployment settings, provider bills, Python dependency advisories, and actual newsletter delivery remain unverified. These limitations prevent a production certification, but do not block the implementation plan below.

## Pipeline coverage

| Pipeline | Main entry points | Assessment | Main work |
|---|---|---|---|
| Category/method configuration | `questions/`, `aliases/`, `providers.json`, `lib/categories.ts` | Three active categories; method consistency incompletely enforced | F05, F10, F24 |
| Hosted measurement | `run.py`, engine base, OpenAI/Anthropic/Perplexity adapters | Good error-as-data pattern; missing durable intermediate state | F03–F05, F17 |
| Optional Gemini | `gemini_engine.py`, disabled registry entry | Disabled deliberately; no live qualification claimed | F26; keep disabled until separately qualified |
| Local CLI measurement/fallback | `cli_provider.py`, `cli_engine.py` | Allowlisted arguments and scrubbed environment; not an OS sandbox | F14, F17 |
| Hosted batch extraction | `extract.py` | Already batches; schema and lifecycle recovery gaps | F03, F16 |
| Normalization/quarantine | `normalize.py`, `checks.py`, `loadQuarantine()` | Canonicalization exists; gate/admin drift remains | F05, F18 |
| Recovery/re-extraction | `reextract.py` → `persist()` | Reuses paid answers; can overwrite another published destination | F02, F08, F15 |
| Publication/report generation | `persist()`, `report.py` | Held/published separation is good; non-atomic persistence | F02–F05, F26 |
| Weekly Windows job | `weekly-run.cmd`, task installer | Pull, dirty guards, checked push exist; recovery state can block next run | F04, F20, F21 |
| Cloud measurement/watchdog | `.github/workflows/weekly.yml`, `watchdog.yml` | Measurement cron intentionally off; watchdog independently scheduled | F21, F27 |
| Public reading | Home/chart/brand/compare/consensus/questions/categories | Strong, data-specific interface; weak evidence drilldown and input equivalence | F11–F12, F22, F25, F28 |
| Distribution/discovery | Atom, sitemap, robots, llms.txt, social image/share | Native lightweight design; historical links lack stable result identity | F22, F26, F30 |
| Admin editing/provider detection | `/admin`, `/api/admin/*` | Auth checked twice; editor can clobber changes and configure unsupported inputs | F09–F10, F24, F29 |
| Signup/contact | `Subscribe`, `Contact`, `/api/subscribe` | Provider forwarding and RSS fallback; delivery claim outruns evidence | F23 |
| Audience ingestion/dashboard | Beacon, proxy, `/api/track`, analytics/rate limiter | Sensible agent/human separation; ingress and outage semantics need work | F18–F19, F24 |
| Vault reports | `sync_vault.py`, `sync-vault.cmd` | Ownership checks and idempotent generated notes; status propagation incomplete | F20, F26 |
| Vault audience archive | `sync_analytics.py` | Raw JSON replacement is atomic; totals are broken for new snapshots | F06, F18 |
| Verification/supply chain | CI, Python tests, agreement tests, package locks | Existing checks green; notable adversarial cases and advisory gate absent | F01, F13, F27 |

## Findings and concrete fixes

**30 finding groups: 1 P0, 13 P1, 15 P2, 1 P3.** Priority describes remediation order and potential impact, not evidence of exploitation. P0 blocks further exposed Windows hosting; P1 addresses archive integrity, material correctness, accessibility, or significant operational risk; P2 addresses bounded correctness/usability/reliability gaps; P3 is maintenance.

### F01 — P0 — vulnerable installed runtime dependencies

**CONFIRMED versions and advisories; exploitability of the public deployment UNVERIFIED.** Installed Next is **16.3.2**, Sharp **0.35.3**. The npm production audit reports critical Next advisories and a high Sharp advisory. The Windows RCE advisory applies to affected Windows-hosted App/Pages Router servers without Cache Components; this repo uses App Router and does not enable Cache Components. That matters directly to the documented Windows local-hosting workflow. It does not establish that Vercel is subject to the Windows-specific path.

Update Next to a compatible patched version **at least 16.3.3**, resolve Sharp to **at least 0.35.4**, regenerate the lockfile deliberately, and run the existing tests/build plus an advisory scan. Inspect the installed Next guides before any accompanying API changes. Do not run `npm audit fix --force` blindly. Separately assess whether image optimization accepts attacker-controlled AVIF input; that reachability was not established here.

Acceptance: installed and locked versions are patched, the production dependency scan no longer reports these advisories, local build succeeds, and the deployed dependency version is verified after release. Sources: [maintainer Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next image optimization advisory](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

### F02 — P1 — published archive can still be overwritten

**CONFIRMED, reproduced against a temporary published destination.** `reextract.py:60–68` rejects an in-place read of a published **source**, but `:127` permits combining `--in-place` with an arbitrary `--out-date`, and `:177` passes `overwrite=True` to `run.py:243`. A held source can therefore target a different date that already has a published record. `persist()` exempts any existing destination when overwrite is true. Its `exists()` followed by `write_text()` is also not an exclusive creation operation.

Enforce immutability **in `persist()` based on the resolved destination**: no overwrite of `data/runs`, regardless of caller. Limit in-place replacement to the actual held source, validate date/category components, and use exclusive/atomic publication with collision handling. A held-to-published promotion must leave original evidence available.

Acceptance: held source + existing published output date refuses before extraction spend; simultaneous publication attempts cannot replace or truncate the winner; an interrupted write never leaves valid-looking partial JSON. Retain the reproduction as a regression after reversing its expected behavior.

### F03 — P1 — paid answers have no durable checkpoint; duplicate detection happens after spend

**CONFIRMED source path.** In `run.py:164–203`, completed answers accumulate in memory. The first run-record write occurs only after extraction, normalization, history loading, and checks. A process kill, machine restart, or unexpected failure in that interval loses paid work. `persist()` checks a date collision only after all calls have completed. The comments document that this late collision has already been costly historically; this audit did not rerun it live.

Add one append-only answer journal per run attempt, keyed by category/question/engine/repeat, and checkpoint the batch ID immediately after submission. Check known final-path collisions before calls. Resume missing work from the journal; do not deduplicate the intentionally independent engine repetitions. Extractor retries should reconnect to an existing batch before starting a replacement.

Acceptance: kill after ten mocked completed calls, restart, and observe exactly the remaining calls; force extraction/report failure and recover all previously completed answers; duplicate final identity makes zero calls. A JSONL journal and small manifest are sufficient—no queue service is needed.

### F04 — P1 — a later category preflight can strand earlier successful categories

**CONFIRMED source path.** `run_category()` raises `SystemExit` for budget/configuration failures (`run.py:121,138,162`), and `main()` intentionally catches only `Exception` (`:348` comment). Those preflights execute **inside** the category loop. Category A can persist successfully, then B's budget preflight exits the process with code 1; `weekly-run.cmd` commits nothing for that exit code. A failed report write can similarly leave a public-side JSON while the category is reported failed.

Preflight global prerequisites once before spend. Represent later category refusals as structured category outcomes, continue or skip according to that outcome, and publish any completed categories through the normal exit-2 handling. Make the persisted record and report status explicit; do not label all completed work “gone” on an unrelated later refusal.

Acceptance: A succeeds, B exceeds budget, C remains eligible; A survives and is included in the intended commit, B is reported refused, and the result is not an unclassified crash.

### F05 — P1 — the archive does not fully freeze or enforce the method

**CONFIRMED; partial-population and repeat-count cases reproduced.** `checks.py` compares engine names when versions match, but not repeat counts, exact question text, model IDs, tool configuration, or extractor prompt/schema. It explicitly skips declared engines with no rows. Run records contain IDs, not the question text snapshot; `lib/data.ts:162`, `/questions`, charts, and consensus join historical answers to **current** YAML. `movement()` receives standings without method identity, so method changes and re-read records can become ordinary week-over-week movement. `brandHistory()` counts run files, including future re-reads, as weeks.

Stamp each new run with its question snapshot, requested/returned models where available, tool/prompt/schema hashes, and method identity. Validate the complete expected `(engine, question, repeat)` population and uniqueness. Compare declared identity changes before calls. Suppress cross-method deltas and distinguish measurement date from reprocessing date in every consumer. For old records, use the original git snapshot only when provenance supports it; otherwise show a legacy limitation.

Acceptance: same-version question/repeat/model changes refuse; missing and duplicate rows hold; an edited current YAML file cannot relabel an old answer; re-extracting a week does not invent a second measured week. This is the shared fix for history, feed, charts, evidence pages, and reports.

### F06 — P1 — analytics all-time totals discard new-format days

**CONFIRMED, reproduced.** `scripts/sync_analytics.py:172` adds `_agents` metadata and serializes with sorted keys. `write_index():310` tries `int(count)` on **every** field; `_agents` sorts first and is a dictionary. The caught `TypeError` skips the rest of that file. A saved day containing seven human views produces an index with zero human views.

Skip metadata before summing, validate numeric counters independently, and report malformed raw files rather than silently claiming a complete total. Rebuild only generated notes/indexes from preserved raw JSON.

Acceptance: new snapshot-format days, legacy days, and mixed archives all sum correctly; one corrupt field cannot discard an otherwise valid day's counts. Rebuild against a copy before applying to the vault.

### F07 — P1 — admin cost and health omit all held runs

**CONFIRMED.** `lib/data.ts:113` scans only `data/runs`; `app/admin/page.tsx:107–119` derives “Last run cost,” “Every recorded run,” and engine health from that set. The archive contains **4 published records / 900 rows** priced at **$19.5030**, plus **5 held records / 1,725 rows** priced at **$103.4102**, at repository rates. September 7's three held categories alone price at **$76.4527**. The dashboard's latest priced date therefore remains August 24 rather than September 7.

Load published and held **attempt records** for operations, retain their state, and choose the latest attempt for health/cost. Keep public chart readers restricted to published records. Reconcile duplicate measurement provenance before calling the combined amount spend: the $122.9132 sum of all nine files is not an invoice and can include reused engine usage.

Acceptance: a latest held run updates operational cost and health without appearing on a public chart; all totals declare completeness and billing scope.

### F08 — P1 — the budget is an estimate with accounting holes, not a dependable spend ceiling

**CONFIRMED; zero-cost estimate reproduced.** `budget.py` silently skips unreadable files despite comments promising reduced confidence. It prices by `run_date` and present rates; re-extraction copies original engine usage to a new record and strips previous extraction usage. That can double-count old engine usage across files or lose prior extraction spend in place. An all-extraction-failed run with paid engine usage yields zero successful rows, a **$0 estimate with `confident=True`**. No budget check runs in `reextract.py`.

Separate usage events from chart records: stable measurement/attempt IDs, billed stage, actual usage, capture timestamp, and price version. Reprocessing adds its own cost without rebilling copied engine usage. Mark missing/unpriced data explicitly; fail the budget preflight or require an explicit override when costs are unknowable. Use a conservative fallback when there are no successful rows and enforce the check for re-extraction too.

Acceptance: original + re-read count engine spend once and both extraction attempts; an unreadable record cannot produce a confident total; fully failed extraction cannot predict a free next run. Reserve projected spend under the same run lock to avoid concurrent starts exceeding the estimate.

### F09 — P1 — stale admin editors can overwrite newer remote changes

**CONFIRMED source path.** The editor starts from deployed local file content. On save, `/api/admin/commit:75` fetches the **latest** remote SHA and supplies it with potentially stale browser text (`:90`). GitHub's conditional write then accepts the stale content because the server has supplied a fresh SHA. The browser also never resets its saved baseline after a successful commit.

Send the baseline blob SHA with the edit and reject if it no longer matches. Return the committed SHA/content baseline and update client dirty state only to the saved payload. Show a readable diff and conflict recovery. Engine changes and required category version changes need one atomic commit or a draft change for review.

Acceptance: two editors open A; editor 1 saves B; editor 2's stale A→C receives a conflict and cannot erase B. Saving once clears dirty state without erasing edits typed during the request.

### F10 — P1 — admin and local configuration validators accept incompatible inputs

**CONFIRMED.** The provider file is parsed as YAML in `/api/admin/commit:109`, but Python and the web registry read it as JSON. A YAML-only provider submission can commit and then break both consumers. Unsupported API IDs and arbitrary env variable names are accepted even though adapters are fixed. `runs_per_question` accepts fractional and unbounded values; Python truncates it with `int()`. Alias values are only checked as arrays, not as lists of strings. Local registry parsing checks little beyond an ID, and duplicate CLI/API IDs can overwrite entries in the engine dictionary.

Validate provider JSON as JSON; enforce adapter IDs, exact allowlisted CLI flags, unique IDs, valid roles, and accepted credential names. Validate finite positive integer counts with a practical ceiling, unique nonempty question IDs, string aliases, and alias collisions. Apply the same semantic contract at the local load boundary, not just the UI. Use `Object.hasOwn` for writable target membership.

Acceptance: fractional counts, duplicate IDs, unknown enabled adapters, YAML-only provider files, and nonstring aliases are rejected before either a commit or a model call. Keep positive checks for every currently valid configuration.

### F11 — P1 — metadata and operational labels fail minimum text contrast

**CONFIRMED tokens and rendered use.** `app/globals.css:36,63,87` defines `--fg-3` as `#8a8a8a` on white and `#6a6f77` on near-black. Reproduced ratios are **3.45:1 light, 3.94:1 dark**, below 4.5:1 for ordinary small text. These tokens label dates, denominators, disclosures, question engines, and other meaningful content—not just decoration. Fix the token or reassign meaningful labels to `--fg-2`; recheck on actual panel surfaces in both themes. The selected Geist design is not the defect.

Acceptance: computed contrast for small meaningful text is at least 4.5:1 across surfaces; disabled controls are evaluated separately. Suggested UI pass: `$impeccable harden`. Standard: [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

### F12 — P1 — question details require a mouse and disappear on mobile

**CONFIRMED source and mobile DOM.** `components/ui.tsx:79` exposes only aggregate prose under `role="img"`; question cells have no focus or activation semantics and use `onMouseMove`. `.board-read` is `display:none` below 720px (`globals.css:811`). A keyboard or phone user cannot inspect the same per-question values a mouse user can.

Keep the visualization, add a labeled native question selector with an always-available readout and exact counts, plus links to the relevant answers. This avoids adding hundreds of focus stops. Provide a text/table representation with question names and values. Mark selected question state programmatically.

Acceptance: keyboard and touch users can select any question, read exact numerator/denominator, and open its evidence at 390px and desktop widths. Suggested pass: `$impeccable adapt`, then `$impeccable harden`; WCAG 2.1.1/1.1.1 apply.

### F13 — P1 — integration test deletes the configured analytics data

**CONFIRMED code; not executed.** `tests/analytics_contract.py:32–65` loads `.env.local` and `clear()` deletes the current daily key, `a:feed`, and `a:seen`. A localhost web URL does not imply a disposable Redis database. If the environment points at production, running the documented check destroys operational evidence.

Require explicit test credentials and a unique test namespace understood by both app and script, or use a disposable Redis instance. Reject production/default namespaces. Cleanup must only touch keys created by that test run. Add it to CI only after isolation is enforced.

Acceptance: missing test configuration refuses without any Redis command; production-shaped configuration cannot delete a key; two test runs do not share counters.

### F14 — P1 — local extractor fallback still runs untrusted text with host access

**CONFIRMED containment limits; exploitation UNVERIFIED.** `cli_provider.py` documents that a temporary cwd and scrubbed environment are not a sandbox. Claude's pinned command does not itself impose OS filesystem/network isolation. Reusing the operator's home/config directories exposes a larger trust boundary than a mechanical extraction task needs. Codex read-only behavior is stronger for writes but not proof against all sensitive reads. The README correctly acknowledges these limits.

Keep hosted extraction primary. Do not silently fall back to an unrestricted agent for untrusted stored answers; require an explicitly qualified, isolated extraction profile with only needed credentials and no tools, or hold with recoverable answers. Engine-role changes remain a method decision. Qualify flags against harmless canary files and a controlled network destination, not private user files.

Acceptance: the extraction process cannot read outside its input area, write outside its output area, or send arbitrary network traffic. No such live qualification was attempted in this audit.

### F15 — P2 — re-extraction loses original fetch timestamps and mishandles chronology

**CONFIRMED, timestamp loss reproduced through the actual mocked entry point.** `reextract.py:73–99` rebuilds `EngineAnswer` without `fetched_at`. Its history selection excludes two dates but does not restrict the comparator to dates before the source measurement; a re-read may be checked against a later measurement. The record stores `measured_on`, but public charts/Freshness/report/feed largely display `run_date` as the measurement date.

Copy original timestamps and immutable measurement metadata; record reprocessing separately. Select prior comparable **measurement**, not the last remaining file. Acceptance: a historical re-read retains every fetch timestamp, displays its original measured date, and never compares to a future week. Depends on F05.

### F16 — P2 — extraction validation can turn malformed output into a clean answer

**CONFIRMED, empty-object case reproduced.** `_apply()` accepts `{}` as an error-free, non-refused answer with no brands. `bool("false")` becomes true; invalid positions are coerced; duplicate/invalid positions are not rejected at the boundary. Literal substring support is a useful floor but not proof that a company is an option. Batch result handling marks IDs seen before complete parsing and does not explicitly enforce completion/stop reason. Provider adapters similarly do not consistently distinguish truncated responses from completed answers.

Use strict response validation shared by CLI/live/batch paths: a real boolean, valid brand list, positive unique positions, and completion status. Invalid output becomes an extraction error eligible for bounded retry. Preserve usage even for invalid output. Retain occurrence checks but do not treat them as semantic validation.

Acceptance: `{}`, string booleans, truncated JSON, duplicate IDs, and invalid positions cannot silently reduce mention counts; valid refusals remain refusals. Resolve incomplete batches by durable batch ID (F03).

### F17 — P2 — retries and batch waits waste time or obscure costs

**CONFIRMED retry ordering; timing impact PROBABLE.** `Engine.is_retryable()` accepts any 429/rate-limit exception before checking quota/billing language; the offline probe retries `429 insufficient_quota`. Every submitted task still runs after a permanent provider-wide failure. Batch timeout counts sleep intervals rather than monotonic elapsed wall time, excluding retrieval/retry time. A retrieval exception after submission does not go through the timeout-only cancellation path. CLI subprocess timeout does not establish termination of every Windows descendant.

Classify permanent quota/auth faults before transient throttles; stop unsent tasks for that failed provider while recording their skipped state. Use an elapsed-time deadline and reconcile/cancel submitted batches on all terminal failure paths. Measure attempts separately from successful replies. Verify process-tree termination with a harmless fixture.

Acceptance: quota error gets one attempt; genuine throttling gets bounded backoff; slow polling respects the overall deadline; no abandoned child or billed batch is silently forgotten.

### F18 — P2 — analytics/quarantine implementations have drifted

**CONFIRMED source and archive-update reproduction.** Python's assistant-referrer list includes `bing.com`, `duckduckgo.com`, and `openai.com`; TypeScript deliberately excludes them. The admin quarantine loader counts raw spellings, while the gate folds them via `_key`; its minimum-two floor also differs from the gate at small samples. `write_raw()` treats a larger **sum** as safe even when an old field disappears, and regenerates `_agents` metadata whenever totals grow despite claiming to freeze it.

Share the tiny classification data or add an actual parity contract; use identical quarantine grouping and thresholds. Preserve captured agent metadata across refreshes. Reconcile counters per field with an explicit reset policy, retaining prior snapshots when totals unexpectedly regress. Do not invent a monotonic aggregate from incompatible counter resets.

Acceptance: both languages classify the same host fixtures and same quarantine population; increasing another counter cannot erase an older dimension; changing `agents.json` does not relabel an already archived event.

### F19 — P2 — public analytics input and outage handling are inconsistent

**CONFIRMED source; production abuse not tested.** `/api/track` parses arbitrary JSON then accesses `body.path`; JSON `null` is not guarded and can cause a 500, contradicting its unconditional-204 contract. Proxy writes bypass endpoint rate limiting and accept arbitrary path cardinality. Human missing-page requests are recorded by the proxy, while the layout beacon may also report that pathname as a normal page view. `totals`, `feed`, and `cadence` return empty values on backend errors without exposing an unavailable state, and reads lack the write path's 800ms bound. The pseudonym fallback uses the public string `unprompted` if no admin secret exists.

Validate body shape and bounded size before dereferencing. Apply path/counter bounds at the shared writer and cap or group unknown paths. Carry confirmed 404 state into the beacon. Return `{status, data}` for unavailable analytics; add bounded reads. Require a real hashing secret whenever collection is enabled. Acceptance: `null` returns 204, an unavailable backend renders unavailable rather than zero, and a 404 is never a successful page view.

### F20 — P2 — failure/status/commit handling can mislead or block the next schedule

**CONFIRMED source.** `notify.py` writes tracked `data/last-run.json` on failures before exiting. Failure branches leave it dirty, and the next job's dirty-data guard refuses until manually resolved. The successful path writes “published” **before** commit/push; a pushed commit is not verified website deployment. `git add data reports` does not exclude already staged unrelated changes from the eventual commit. Vault sync failures are not fully propagated.

Use a local attempt-status artifact for pre-push failures, commit completed measurement metadata deliberately, and distinguish measured/held/committed/pushed/deployed states. Check or isolate the staging area, stage only the intended attempt paths, and report each archive step independently. Keep manual remediation guidance specific; do not automatically discard user work.

Acceptance: a failed push followed by recovery cannot permanently self-block the schedule; a pre-staged unrelated edit is not included; UI never calls an unverified deployment successful.

### F21 — P2 — watchdog date assumptions conflict with catch-up scheduling

**CONFIRMED source.** The task uses `StartWhenAvailable` and the runner defaults to today's date, but `watchdog.week_status()` only recognizes an exact Monday directory. A Tuesday catch-up run remains “missing” to that test. `--date` still consults the actual current UTC hour when deciding which Monday to inspect. `open_issue()` ignores subprocess failure status and can print “opened” when creation failed. Never-measured categories are exempt forever, not just during onboarding.

Record scheduled-week identity separately from actual measurement time; make the watchdog inspect that identity. Inject the observation time for deterministic date tests, check issue command return codes, and give newly activated categories an explicit first-due date. Acceptance: late-but-recorded, still-running, held, absent, and newly due weeks are distinct; failed notification is visible. No issue was opened during this audit.

### F22 — P2 — stale data and evidence links are harder to use than the product promises

**CONFIRMED public UI and source.** On September 14 the public homepage showed **August 22**, and the image chart **August 24**, with a countdown to the next run but no explicit stale label. `ShareRow` sends every category result to the homepage. Feed entries also link to a category's moving latest page. `/questions` shows extracted names but not raw prose or per-answer source links. The archive exists in Git, but readers must reconstruct a result themselves.

Add a visible measurement age/held update notice; introduce immutable date/category result links and a native date selector. Make share, feed, and evidence links retain category, measurement date, and question. Show raw answers under native `<details>` with engine/repeat/timestamp and cited URLs. Keep stable latest links as conveniences.

Acceptance: a shared image-category result opens that exact dated result; a reader reaches the answer supporting a count in two actions; a new deployment cannot change old result links. Suggested pass: `$impeccable clarify`, `$impeccable onboard`.

### F23 — P2 — signup success promises delivery that inbox capture does not prove

**CONFIRMED source; newsletter delivery UNVERIFIED.** `Subscribe.succeed()` says “You will get the chart every Monday” for both a real provider and a message delivered to the operator's inbox. Inbox receipt alone does not establish a recurring mailing workflow. The explanatory copy always claims no mailing provider exists even after configuration changes. Browser/provider fetches lack explicit deadlines; contact's unconfigured state exposes an environment variable and says email works without an email link.

Use configuration-aware copy: distinguish subscription confirmation from a request received by the operator. Add bounded request timeouts, preserve the user's input on failure, and provide a working contact fallback. Count provider-confirmed subscriptions separately from browser-reported completion. Acceptance: inbox fallback never claims automated subscription; timeout offers retry without clearing the email; an enabled provider produces matching explanation. No external test message is required for offline cases.

### F24 — P2 — admin controls do not cover the actual operating model

**CONFIRMED.** Writable question/alias targets are pinned to `CATEGORY`, so only the default category can be curated from admin. `activeExtractor` chooses any API entry regardless of readiness (`app/admin/page.tsx:72`), while Python falls through when its key is absent. Hosted provider status measures the Vercel environment, not the Windows runner, yet the dashboard uses “all reachable” language. Repeated ON/OFF buttons lack provider-specific accessible names. “Confirmed signups” is still an unauthenticated browser counter despite its comment warning otherwise.

Add an allowlisted category selector, constrained supported-provider controls, and a runner-generated status snapshot labeled with time and host. Separate configured/on-PATH/auth-checked/last-call-success states. Fix the selected-extractor predicate, button names, live status announcements, and saved baselines. Acceptance: all three categories can be edited safely; a missing API key selects the same fallback in UI and runner; stale host status is visibly stale.

### F25 — P2 — consensus and movement overstate weak observations

**CONFIRMED, three offline reproductions.** Equal per-engine counts break alphabetically; every engine tied Alpha/Beta at 50/50 becomes a “settled” Alpha result. Three engines each picking a different brand create an alphabetical “majority,” and divergence blames the other two. A brand seen once in a one-answer previous sample and absent in the next is always marked significant and can become The Snub. The normal approximation also assumes independence more strongly than fixed-question repetitions justify.

Represent tied picks as ties and missing observations as missing; compute divergence only against a genuine majority or label plurality explicitly. Evaluate dropouts with the same sample-aware rule as other movement, and suppress editorial labels on inadequate samples. Keep raw fractions. A stratified uncertainty analysis by question/engine is an evaluation proposal, not a validated replacement statistic from this audit.

Acceptance: ties cannot manufacture consensus or contrarian labels; singleton dropouts never produce a confident narrative. Add hand-calculated fixtures in addition to cross-language agreement.

### F26 — P2 — source/provenance claims exceed what adapters preserve

**CONFIRMED source; statistical causal impact unmeasured.** Anthropic stores URLs from `web_search_tool_result`, which are retrieved results, not necessarily citations used in final prose; OpenAI collects answer citations. Gemini reconstructs some source URLs as domain roots and thus loses page identity. `ChartBoard` calls the aggregate “where the recommendations actually come from,” a causal statement the stored URLs cannot prove. Reports use current affiliations and state that Claude performs extraction even when a CLI fallback could have done so.

Store typed retrieved/cited source evidence and preserve original URL plus normalized host separately. Label source counts as observed citations/retrievals, not causal attribution. Derive extractor labels and affiliations from frozen run provenance. Acceptance: source counts compare like with like, original URLs are retrievable, and reports identify the actual reader. Keep Gemini disabled until its documented grounding and pricing qualification is performed.

### F27 — P2 — CI/workflow coverage leaves preventable failures

**CONFIRMED configuration.** The watchdog directly interpolates `inputs.date` into shell source, unlike the safer environment-variable pattern in the weekly workflow. Dispatch input is privileged, so this is not an unauthenticated route, but it is avoidable shell injection. The cloud measurement timeout is 180 minutes while batch waits alone can consume three hours across categories. Python dependencies float within wide ranges, Node's supported runtime is not declared in package metadata, and CI does not run dependency scanning, isolated analytics acceptance, or publication immutability checks.

Pass dispatch input via an environment variable and parse it as a date. Align cloud timeout and adapter availability with the chosen method before re-enabling that path. Lock or constrain known working Python resolutions; declare Node runtime expectations; add a focused dependency scan and adversarial fixtures for F02/F05/F06/F09/F13. Pin action revisions through a maintained update mechanism if supply-chain policy requires it.

Acceptance: shell metacharacters remain inert data, install resolution is reproducible, and each top-priority regression fails CI. Hosted workflow success/deployment success must be verified separately from the local build.

### F28 — P2 — repeated archive reads and unnecessary client data grow with history

**CONFIRMED repeated work; user-visible latency impact PROBABLE.** `latestRun()` rescans history; pages then call `loadHistory()` again. Brand pages/metadata repeat scans and standings; comparison resolution runs for metadata and content. Every `LiveBoard` row receives the full `BrandStanding`, including per-attempt `cells` that the board does not use. With 18 brands and 225 observations, that alone is 4,050 boolean entries in the server-to-client payload. Admin loads 30-day totals, and `AdminAnalytics` independently requests overlapping data.

Pass a single loaded run/history through page computation, use request-scoped memoization where needed, and send only fields the interactive board renders. Pass already-fetched totals to the analytics child. Benchmark before adding persistent caches; the current build succeeds quickly. Acceptance: compare payload bytes and archive reads before/after, identical rendered metrics, no stale data between builds.

### F29 — P2 — admin session expiry is only browser-side

**CONFIRMED code; credential compromise UNVERIFIED.** The cookie is a deterministic HMAC of a fixed label, and validation does not check issuance or expiry. The browser's eight-hour max-age removes its copy, but a copied token remains usable until password rotation. There is no application-level admin guessing limit. Malformed percent encoding can throw in `isAuthorised()` instead of returning false.

Keep single-operator auth, but sign an expiry-bearing token and check it server-side; reject malformed cookies safely. Add a bounded authentication-attempt limit or a verified deployment protection rule. Do not replace this with an account platform. Acceptance: replay after expiry fails, malformed cookies return unauthorized, and repeated wrong credentials are limited without locking out ordinary readers.

### F30 — P3 — stale explanations and unused compatibility code increase maintenance cost

**CONFIRMED.** PRODUCT.md expressly describes an obsolete launch audience. README/method/llms counts of checks diverge. Commentary claims schema parsing is impossible to fail, extraction fallback is equivalent, and some production state is known when only configuration is tested. Several long historical narratives sit beside small helpers. `versionArgs` has no runtime consumer; `available_engines()` has no caller; `cli_extractor()` is retained for tests after real callers migrated.

Refresh the product/method summary from the current system. Move historical incident narrative to a linked operations document while retaining security rationale at trust boundaries. Remove unused fields/functions only after caller checks. Maintain the valuable cross-language metric parity rather than trying to eliminate all duplication.

## Token and cost efficiency plan

### Measured baseline

The current banks have 15 questions each, five repeats, and five enabled engines: **375 engine calls/category, 1,125/week**, including **450 CLI engine invocations**. Three rows failed in the September 7 records; extraction tokens total **1,844,511 input + 229,850 output**. At the repository's extraction rates and 0.5 batch multiplier, that is **$7.4844**, about **9.8%** of the **$76.4527** recorded API-priced week. These are repository-rate calculations, not verified invoices, and exclude unreported subscription use and unknowable failed-attempt charges.

The registry notes claim roughly 48.5k Claude CLI and 9k Codex context tokens per extraction call. Those are historical project notes, **not freshly measured in this audit**; they must not be multiplied into a claimed current saving. The code records no CLI token usage. It is therefore impossible to give an evidence-based total token budget for the full pipeline today.

| Order | Change | Expected benefit | Guardrail / acceptance |
|---:|---|---|---|
| 1 | Checkpoint answers and reconnect to batches | Eliminates re-querying completed work after interruption | Count provider calls in kill/resume test; each intended repetition remains independent |
| 2 | Separate alias-only replay from model extraction | Future alias changes need **zero model tokens** when raw structured extraction is preserved | Store raw extracted names before normalization; existing normalized-only records may require re-read |
| 3 | Re-extract only failed/invalid rows under the same extractor identity | Avoids paying to reread valid answers | Any prompt/model/schema change requires a full comparable re-read or an explicitly mixed record |
| 4 | Measure CLI overhead and cache usage | Makes subscription token use visible | Record model, context/input/output/cache usage and duration if the harness exposes it; unknown stays unknown |
| 5 | Cache deterministic extraction by exact answer + extractor/prompt/schema identity | Avoids exact repeated parsing and recovery duplication | Preserve each engine observation; do not cache the measurement requests themselves |
| 6 | Evaluate a cheaper extractor on held-out, human-labeled answers | Potential extraction saving; **not yet quantified** | Brand precision/recall, first mention, refusal, rank stability, and difficult category cases |
| 7 | Evaluate stable-prefix prompt caching | Possible additional input saving | Verify provider minimums, actual hits, cache-write cost, and batch timing before enabling |

Batch extraction is already implemented; credit for adopting batching again would be fictitious. The current extraction instruction prefix is short, so prompt caching may not qualify or may save little. Do not pad it merely to hit a cache minimum. Anthropic documents batch/caching compatibility and notes cache-duration considerations for asynchronous batches: [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

Do not halve repeats, remove an engine, force a short shopping answer, or reuse one engine response across repeated trials and call that an optimization. Those change the measurement population. Any such experiment needs a new method version and an explicit user-facing break in the series. The existing extraction comparison against an earlier model's output measures **agreement**, not truth; the claim that disagreement is the task's “noise floor” is not established by that comparison alone.

An evaluation dataset can start with the existing 150-answer sample described in the code, if its actual selection and labels are recovered. Add human adjudication and a held-out set, keep category/engine/repetition provenance, and report disagreement examples. No new paid benchmark was run here.

## Usability improvements worth implementing

The product's strongest asset is its checkable record. Improve the path from a result to its evidence before adding general-purpose dashboards.

1. **Result → question → answer.** Select a question on any device, see the exact count, expand the original answers, and follow citations. Native select/details controls are enough.
2. **Stable historical links.** Add date/category selection and correction lineage; make sharing preserve the chosen record. Users should be able to verify an old screenshot without knowing Git.
3. **Honest freshness.** Display “Latest published measurement: [date]”; identify overdue or held updates without suggesting a new measurement happened. Keep next scheduled time separate from promised publication time.
4. **An actionable operator queue.** Group holds by category and reason, show affected answers and current alias decisions, preview a change, then commit with conflict detection. No new workflow engine is required.
5. **Explain uncertainty in place.** Ties, missing answers, re-reads, and changes of method should be visible next to the affected figure. Avoid a footnote that requires reading the entire methodology to understand a headline.
6. **Reliable return paths.** RSS remains a good native choice. Make email states truthful and keep compare parameters in links. Defer account creation, personalized alerts, and a custom email sender until actual reader demand warrants them.

### UI quality score

This is a limited audit score, not a WCAG certification or a measured Core Web Vitals score.

| Dimension | Score / 4 | Evidence |
|---|---:|---|
| Accessibility | 2 | Labels/focus exist; contrast and keyboard-equivalence failures are material |
| Performance | 3 | Static public rendering, small dependency set; repeated scans/client payload need measurement |
| Responsive design | 2 | Homepage reflows at 390px; the central question inspection disappears |
| Theming | 3 | Shared tokens and working theme state; muted text fails contrast |
| Implementation integrity | 2 | Coherent product-specific board; stale-state, evidence, and delivery claims drift |
| **Total** | **12 / 20** | **Acceptable design foundation; significant functional work remains** |

The detector flagged the `.snub` red left border and Geist font choice. The border expresses an existing movement signal, and Geist is an explicit established design choice; these are not substantiated usability defects. Preserve the visual identity. The global reduced-motion override exists, but replacing it with intentional static states is a minor follow-up, not a reason to redesign the site.

Recommended UI sequence: `$impeccable harden` for contrast and truthful states, `$impeccable adapt` for question access, `$impeccable clarify` for evidence and freshness, then `$impeccable polish`. These can be implemented individually or together; repeat the bounded audit after fixes.

## Implementation sequence and acceptance gates

Effort bands are planning estimates for focused implementation **plus checks**; deployment/provider access and user evaluation can add elapsed time. Total is approximately **16–27 engineering days**, not a commitment or a request to implement all features immediately. Several small patches can ship much earlier.

| Phase | Deliverable | Findings | Estimated effort | Exit gate |
|---|---|---|---|---|
| 0 | Patched runtime and safe test execution | F01, F13 | 0.5–1 day | Advisory scan clear for named issues; tests cannot touch production keys |
| 1 | Immutable publication and durable recovery | F02–F04, F15, F17, F20–F21 | 3–5 days | Crash/resume/collision/partial-category fixtures pass; no paid answers lost in tested failures |
| 2 | Versioned method and trusted parsing | F05, F10, F14, F16, F25–F26 | 4–6 days | Frozen question/model identity, strict output checks, constrained fallback, honest ties/history |
| 3 | Correct operations/accounting | F06–F08, F18–F19, F24 | 3–5 days | Copied archive reconciles; held runs visible operationally; unavailable distinct from zero |
| 4 | Safe editing and usable evidence | F09, F11–F12, F22–F23, F29 | 3–5 days | Conflict test passes; keyboard/mobile evidence flow works; stable links and truthful forms |
| 5 | Measured efficiency and maintenance | F27–F28, F30, token experiments | 2–4 days | Repeatable benchmark, smaller payload/call counts, docs match implementation |

Dependencies matter: F02/F03 precede any recovery automation; F05 precedes historical UI and model substitutions; F13 precedes live analytics testing. F06 and contrast-token fixes are small independent improvements once safe fixtures are in place. Each phase should be a reviewable change with its own evidence, not one sprawling merge.

The first production acceptance run should use the real scheduler entry point and verify: attempt manifest → complete expected population → gate outcome → local commit → remote commit → hosted deployment → exact dated page. A held result must remain absent from public pages while its cost and reason appear operationally. Provider calls should be limited to the approved normal measurement run; synthetic failure cases belong in isolated fixtures.

## Simplification opportunities

Ranked by likely useful reduction, rather than cosmetic line count:

- **shrink:** Pass one run/history through each page and one audience result through admin children; remove repeated scans and fetches. `app/`, `lib/data.ts`, `components/admin-analytics.tsx`.
- **delete:** Remove unused per-observation `cells` from the LiveBoard payload, preserving them only on the brand page that renders them. `components/chart-board.tsx`, `app/page.tsx`.
- **native:** Use a select/details evidence flow and ordinary date links; skip a chart interaction framework and custom router state.
- **delete:** Remove unused `versionArgs`, `available_engines()`, and the compatibility-only `cli_extractor()` after moving its tests to the real resolver.
- **shrink:** Move incident essays out of implementation files, retaining brief invariants and links. This reduces agent context and reviewer reading without deleting design reasoning.

**Net: approximately 40–100 source lines and 0 dependencies removable in the small dead-code/read-reuse pass; estimate, not an implemented diff.** Comment/document relocation is excluded. Python and TypeScript arithmetic duplication is justified by their separate runtimes and actual agreement tests; replacing it with an HTTP service would increase complexity.

## Preserve what works

The repository-backed public archive, explicit held directory, raw answers, API-native engine adapters, registry argument allowlist, schema-shaped extraction, per-engine error gate, shared rate file, real cross-language agreement tests, provider-independent watchdog, labeled forms, native GET comparison form, RSS, and color-independent numeric labels are useful foundations. The recommended changes extend them.

No evidence in this audit justifies a database migration for measurements, another service, a generic plugin framework, an agent swarm, a custom email delivery system, or a visual rebrand.

## Deliverables and next review

- [Python reproductions](reproduce.py) and [their evidence](evidence.json).
- [Metric reproductions](metrics-probes.mjs) and [their evidence](metrics-evidence.json).
- [Tracked-file SHA-256 manifest](manifest.json).
- [Validation summary and dependency advisory identifiers](validation.json).

The reproduction scripts assert current defects so the evidence is repeatable. During implementation, convert the relevant assertions into desired-behavior regression tests; do not add these known-bad assertions to the normal CI suite unchanged.

An unrelated untracked `alias-plan.md` appeared during the audit and was left untouched. This audit adds only its own dated directory. Application fixes and release verification remain the next implementation work, explicitly separated from the completed audit.
