# Independent audit, 2026-08-25

An external audit of the whole project: security, system quality, code quality.
It was run against commit `4e39653` by a separate agent with no involvement in
writing the code, and told to read the real files and verify every finding. It
is published unedited below, including the parts that are unflattering, because
a publication whose pitch is "the method is public and matches the code" does
not get to publish only the audits it likes.

**This is a snapshot, not the current state.** Everything below describes the
tree as of 2026-08-25. Commit `9962c98` acted on it the same day.

## What has been fixed since

| Finding | Status |
|---|---|
| H-2 barely-alive engine could publish | **Fixed.** Any engine failing over 20% of its own calls now holds the week. The denominator question is a separate matter, below. |
| H-5 `reextract --in-place` could overwrite published history | **Fixed.** Enforced from the resolved source path, before anything is spent. |
| H-8 wrapper announced success after a failed push | **Fixed.** Commit and push exit codes are checked and the remote SHA is compared against local before claiming success. |
| H-6 admin engine toggles were decorative | **Fixed.** Hosted engines are read from the registry, an enabled engine with no adapter is an error, and a malformed registry stops the run. Deeper alias-schema validation is still open. |
| M-1 documentation contradicted the system | **Fixed.** |
| M-2 permanent failures retried three times | **Fixed.** Errors are classified; unknown ones stay retryable. |
| M-6 countdown and feed four hours early | **Fixed.** One DST-aware schedule in `lib/schedule.ts`. |
| H-7 extraction was prompt-injectable | **Partly fixed.** Answers are fenced and declared untrusted, and every returned name must occur in the answer it came from. The benchmark half is open. |
| H-3 paid answers not durably recoverable | **Partly fixed.** Schema construction moved inside the protected path and an abandoned batch is now cancelled. Answers still live in memory until a run completes; there is no staging checkpoint. |
| H-4 provenance could not reproduce a run | **Partly fixed.** Records now carry the commit, extractor model, measurement date and source run. The full manifest of input hashes is open. |
| M-7 unpinned dependencies | **Partly fixed.** Upper bounds added and the private SDK import has a tested fallback. No lockfile yet. |

## What is still open

- **H-1, the local CLIs are not sandboxed.** They run with the operator's home
  directory, logins and network access, and they read untrusted web text. This
  is an infrastructure decision rather than a code defect and has not been made.
- **H-7's other half: there is no human-labelled extraction benchmark.** The
  accuracy figures quoted in the code compare one model's reading against
  another's. That can show two readings differ; it cannot say which is right.
- **H-2's denominator.** Errored and refused attempts are excluded from
  Rotation. That is deliberate — an engine outage would otherwise read as every
  brand losing ground — and it is now stated plainly in METHODOLOGY.md rather
  than left implicit. It is not a bug, but the auditor is right that it is
  consequential, and readers should know it.
- **M-3 rate limiting, M-4 the agreement test, M-5 record validation, M-8 cost
  assumptions**, and the dead-code and test-gap tables, are all open.

---

Verdict: Unprompted is a thoughtfully designed, unusually transparent measurement publication with a strong fail-safe instinct, but the current implementation is not yet trustworthy enough to support its central claim that the weekly series is reproducible and append-only. There are no Critical findings, but there are eight High-severity issues: untrusted web/model text is handed to agentic local CLIs that are not actually isolated; the core metric hides failed/refused attempts and permits badly degraded engines to publish; paid answers and Batch API state are not durably checkpointed; method provenance and version enforcement are incomplete; `reextract --in-place` can overwrite published history and ordinary re-extraction relabels old answers as a new week; the admin/provider configuration is not authoritative and malformed configuration is discovered after spending; the LLM extraction layer is prompt-injectable and validated against a circular, non-reproducible benchmark; and the local scheduler can announce success after commit/push failure. The current tree builds and its tests pass, but several tests prove internal consistency rather than the correctness and durability claims that matter most.

| Rank | Severity | Finding | Primary evidence |
|---:|:---:|---|---|
| H-1 | High | Agentic CLIs process untrusted content without a real host boundary | `src/unprompted/cli_provider.py:136-175`, `src/unprompted/engines/cli_engine.py:60-64` |
| H-2 | High | Rotation excludes failures/refusals and the publish gate tolerates severely degraded engines | `src/unprompted/aggregate.py:51-67`, `src/unprompted/checks.py:113-122`, `src/unprompted/checks.py:150-162` |
| H-3 | High | Paid raw answers and Batch API state are not durably recoverable | `src/unprompted/run.py:117-184`, `src/unprompted/extract.py:267-303`, `src/unprompted/extract.py:329-405` |
| H-4 | High | Method-version enforcement and run provenance cannot reproduce the series | `src/unprompted/checks.py:50-74`, `src/unprompted/models.py:86-118`, `lib/data.ts:162-173` |
| H-5 | High | Re-extraction can falsify chronology and overwrite a published run | `src/unprompted/reextract.py:31-45`, `src/unprompted/reextract.py:98-112`, `src/unprompted/reextract.py:133-140` |
| H-6 | High | Admin/provider configuration is partly decorative and is validated too late | `src/unprompted/engines/__init__.py:32-49`, `src/unprompted/cli_provider.py:235-265`, `app/api/admin/commit/route.ts:107-188` |
| H-7 | High | The extraction layer is semantically prompt-injectable and lacks a valid accuracy benchmark | `src/unprompted/extract.py:12-26`, `src/unprompted/extract.py:59-81`, `src/unprompted/extract.py:223-254` |
| H-8 | High | The weekly wrapper hides commit/push failures and can stage unrelated data changes | `scripts/weekly-run.cmd:17-46` |
| M-1 | Medium | The public methodology and operating documentation materially contradict the live system | `METHODOLOGY.md:3-25`, `METHODOLOGY.md:70-101`, `README.md:102-123` |
| M-2 | Medium | Every exception is retried, including permanent quota/auth/validation errors | `src/unprompted/engines/base.py:73-83` |
| M-3 | Medium | Public write/forwarding endpoints have no online-abuse controls | `proxy.ts:37-66`, `app/api/subscribe/route.ts:26-74` |
| M-4 | Medium | The cross-language agreement test does not execute the production TypeScript metric | `tests/agreement.test.mjs:22-32`, `tests/agreement.test.mjs:99-132` |
| M-5 | Medium | Run-file validation is too shallow for the site's database boundary | `lib/data.ts:78-107` |
| M-6 | Medium | The displayed/feed schedule is UTC while the real task is local Eastern time | `scripts/install-weekly-task.ps1:23-27`, `components/freshness.tsx:18-28`, `app/feed.xml/route.ts:39-42` |
| M-7 | Medium | Python dependencies are unpinned despite private SDK coupling | `pyproject.toml:5-14`, `src/unprompted/extract.py:267-281` |
| M-8 | Medium | Cost reporting records assumptions as measured usage | `src/unprompted/engines/openai_engine.py:36-51`, `src/unprompted/cost.py:66-75` |

## 1. What the project actually is

Unprompted is not primarily a SaaS application. It is a git-backed measurement and publishing system:

1. Three YAML question banks define 15 buyer questions per category and five repetitions (`questions/*.yml`).
2. The Python 3.12 pipeline builds one task per question, engine, and repetition and executes six at a time (`src/unprompted/run.py:35-39`, `src/unprompted/run.py:117-145`). The current registry declares three hosted engines—ChatGPT, Claude, and Perplexity—and two local agent harnesses—Claude Code and Codex—so the intended v2 run is 375 engine calls per category and 1,125 engine calls across the three categories (`providers.json:3-27`, `providers.json:68-98`).
3. Hosted engines use their native APIs and search surfaces (`src/unprompted/engines/openai_engine.py:25-51`, `src/unprompted/engines/anthropic_engine.py:20-56`, `src/unprompted/engines/perplexity_engine.py:23-68`). Local engines call already-authenticated CLI agents and return stdout without citations or metered usage (`src/unprompted/engines/cli_engine.py:23-29`, `src/unprompted/engines/cli_engine.py:60-64`).
4. Every successful prose answer is read again by an extractor. The first enabled API extractor wins, which currently means Claude Opus 5 through one Anthropic Batch API job per category; local Claude/Codex CLIs are fallback extractors (`providers.json:28-66`, `src/unprompted/extract.py:284-407`, `src/unprompted/extract.py:410-453`).
5. Extracted names are canonicalized through category alias maps. Unknown names are removed from chart data and retained in a quarantine list (`src/unprompted/normalize.py:118-142`, `src/unprompted/normalize.py:208-249`). Python then derives standings and six publication checks (`src/unprompted/aggregate.py:51-124`, `src/unprompted/checks.py:40-164`).
6. Passing records go to `data/runs/<date>/<category>.json`; failing records go to `data/held/...`. Passing records also produce Markdown reports, while quarantine files are written either way (`src/unprompted/run.py:189-240`). These files, plus git history, are the database and audit trail.
7. Because the two local engines cannot run in GitHub Actions, Windows Task Scheduler invokes `scripts/weekly-run.cmd` Mondays at 13:00 local time. The wrapper pulls, runs all categories sequentially, commits `data/` and `reports/`, pushes, then mirrors reports into an Obsidian vault (`scripts/install-weekly-task.ps1:23-48`, `scripts/weekly-run.cmd:12-48`). The GitHub weekly workflow is now manual-only (`.github/workflows/weekly.yml:3-15`).
8. The Next.js 16.3 application reads the repository at build/render time; there is no application database. Most public pages and the Atom feed are static, while compare/consensus are request-rendered. The only mutable web operations are an authenticated admin route that commits three exact GitHub paths and a public newsletter forwarder (`lib/data.ts:1-17`, `app/api/admin/commit/route.ts:14-25`, `app/api/subscribe/route.ts:23-26`).

The repository is currently between methods, not at a clean v2 baseline. Published coding and writing runs are method v1 with 225 rows; the latest published image run is method v1 with 225 rows, 24 errors, and only 201 rows in its metric denominator. The held coding run dated 2026-08-24 is method v2 with five engines, 375 rows, 96 errors, and 279 usable rows (`data/runs/2026-08-24/ai-image-generators.json:10996-10997`, `data/held/2026-08-24/ai-coding-assistants.json:12633-12634`). No method-v2 week has been published yet.

## 2. Correctness and security findings

### H-1 — Agentic CLIs process untrusted content without a real host boundary

The exact executable and argument allowlists, `shell=False`, timeouts, empty temporary cwd, and environment allowlist are all good controls. They prevent ordinary command injection and remove easy relative-path/key leakage (`src/unprompted/cli_provider.py:47-89`, `src/unprompted/cli_provider.py:163-185`). They do not sandbox an agent.

The code explicitly acknowledges that a child can still reach the network and wider filesystem by absolute path (`src/unprompted/cli_provider.py:136-151`). It also passes `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR` so the CLIs can find their settings and authentication (`src/unprompted/cli_provider.py:77-84`). Claude is launched with `--strict-mcp-config`, which limits MCP configuration but does not establish an OS filesystem/network boundary (`src/unprompted/cli_provider.py:47-66`).

This matters twice. An extractor receives a verbatim answer that may contain instructions originating in web content (`src/unprompted/extract.py:199-205`). A CLI engine can itself browse attacker-controlled web pages before generating stdout (`src/unprompted/engines/cli_engine.py:60-64`). A successful prompt injection can ask the harness to read an absolute file, use its logged-in network identity, or print sensitive material. That stdout is then eligible to be committed to the public repository. The exact command allowlist does not constrain what the model asks the permitted command to do.

**Fix:** treat local agents as untrusted-code workloads. Run each invocation under a dedicated low-privilege OS account or disposable VM/container with only an empty directory mounted, no access to the operator's home/config tree, no inherited credential stores, output and memory limits, and no outbound network for extraction. If a CLI engine requires browsing, give it an isolated browser/network identity in a disposable VM and never mount host data. Prefer a narrow non-agent API for extraction.

### H-2 — Rotation hides failed/refused attempts and the gate permits badly degraded engines

`brand_week()` defines its denominator as rows with neither `error` nor `refused` (`src/unprompted/aggregate.py:51-67`); the TypeScript site repeats that rule (`lib/data.ts:73-75`, `lib/data.ts:183-186`). The public method instead defines Rotation as `times_named / total_runs` and says each question is asked five times (`METHODOLOGY.md:32-48`). A refusal and a failed attempt are still attempted runs. Excluding them turns provider availability and willingness to answer into selection on the denominator, then labels the result “named in X of runs.”

The publication gate only checks the global error rate (`src/unprompted/checks.py:113-122`) and whether an engine failed *every* row (`src/unprompted/checks.py:150-162`). With five engines, one engine may succeed once and fail 74 of 75 calls: 74/375 is 19.7%, below the global 20% limit, and the all-failed rule is false. That week can publish while effectively measuring four engines. There is no per-engine or per-question completeness threshold.

This is already observable, not hypothetical. The published 2026-08-24 image run contains 24 Claude usage-limit errors—32% of Claude's 75 assigned rows—yet only 10.7% of all rows, so it published using 201/225 answers. The first such permanent error is at `data/runs/2026-08-24/ai-image-generators.json:8630`. Rankings, consensus, self-preference, and week-over-week changes then compare uneven samples.

**Fix:** retain all scheduled attempts in the primary denominator, publish answered/refused/error coverage alongside it, and define an explicit secondary “share of usable answers” only if useful. Hold unless every engine and every question meets a documented minimum completion rate (ideally 100% for this small sample), and distinguish engine-query errors from extraction errors. Add a regression test for one success plus 74 failures, partial per-question outages, and imbalanced refusals.

### H-3 — Paid raw answers and Batch API state are not durably recoverable

All engine answers remain only in the `answers` list until every query finishes, the complete extraction pass finishes, normalization finishes, checks run, and `persist()` is reached (`src/unprompted/run.py:117-184`). The recent Batch failure containment converts ordinary submit/poll/result exceptions into row errors, which is an improvement, but it does not cover process termination, reboot, Task Scheduler's eight-hour kill, disk failure, or an exception before the batch `try` block.

One concrete hole is `_json_format()`: it imports a private Anthropic SDK helper (`src/unprompted/extract.py:267-281`) and is called while building `output_config` before the `try` begins (`src/unprompted/extract.py:301-303`, `src/unprompted/extract.py:329-333`). If that private path moves, the category-level handler logs a crash but has no `RunRecord` to write; every paid engine answer for that category is lost.

Batch recovery is also not real recovery. The batch ID is only printed and kept in a local variable (`src/unprompted/extract.py:329-341`); it is absent from `RunRecord` (`src/unprompted/models.py:86-118`). On the one-hour client timeout, the remote batch is neither cancelled nor checkpointed (`src/unprompted/extract.py:343-351`). The code tells the operator to run `reextract`, which submits a new batch rather than reconnecting to the old one (`src/unprompted/extract.py:378-405`, `src/unprompted/reextract.py:90-92`). The original can later complete and bill as well.

**Fix:** create a durable staging record before the first external call. Append/atomically checkpoint each `EngineAnswer`, then record extraction provider, model, batch ID, submitted custom-ID map, status, and usage before polling. On restart, resume the existing batch or explicitly cancel it before resubmitting. Put schema construction inside the protected path and use a public schema API or committed JSON schema. Promote a complete staging record atomically into `runs` or `held` only after checks.

### H-4 — Method-version enforcement and provenance cannot reproduce the series

The stated series contract says question wording, run count, and engine list require a method bump (`METHODOLOGY.md:127-137`). The only enforced comparison is the engine list (`src/unprompted/checks.py:50-74`). An administrator can change a question or `runs_per_question` without changing `method_version`, and the next run will publish if the output looks plausible. The admin UI merely tells the operator to bump it (`app/admin/page.tsx:292-303`); the commit route does not compare old and new method-bearing content (`app/api/admin/commit/route.ts:116-132`).

The record cannot independently establish what was run. It stores category/date/method number/run count/engine names/extractions, but not question text or a question-bank hash, alias-map hash, git commit SHA, engine model IDs, system prompt/version, extractor model ID, SDK versions, batch ID, task start/end time, or per-answer `fetched_at` (`src/unprompted/models.py:86-118`). `EngineAnswer` creates a timestamp, but `_base_for()` drops it (`src/unprompted/models.py:14-40`, `src/unprompted/extract.py:117-127`). Historical consensus and comparison pages load question text from the *current* YAML, so an old run is displayed against new wording after an edit (`lib/data.ts:162-173`). Model constants such as `gpt-5`, `claude-opus-5`, and `sonar` are code constants, not stamped data (`src/unprompted/engines/openai_engine.py:12-18`, `src/unprompted/engines/anthropic_engine.py:7-12`, `src/unprompted/engines/perplexity_engine.py:14-16`).

Git history helps but does not resolve which same-day commit/configuration a run used, and provider aliases can change remotely without a repository change.

**Fix:** make every run carry an immutable provenance manifest: git SHA; exact question objects; hashes of questions, aliases, providers, and prompts; concrete model/version identifiers returned by providers; extractor schema/model; SDK/package lock hash; timestamps; and an explicit method-series ID. At commit time and preflight, diff all method-bearing inputs against the previous run and require a version bump. Historical pages must read the snapshot embedded in that run, not current YAML.

### H-5 — Re-extraction can falsify chronology and overwrite published history

By default, re-extraction assigns old answers today's date (`src/unprompted/reextract.py:98-102`) and writes them as an ordinary `RunRecord` with no `source_run`, correction/revision marker, or original acquisition timestamp (`src/unprompted/reextract.py:103-112`). The site then treats that file as a new measured week. Movement and brand history can therefore compare August 22 answers re-read on August 25 as if engines were queried on August 25.

Worse, `--in-place` is documented as “only for a run that was never published,” but no code enforces that condition (`src/unprompted/reextract.py:39-44`). If the source came from `data/runs` and the new extraction passes, `persist(..., overwrite=True)` overwrites the published JSON at the same path (`src/unprompted/reextract.py:133-140`, `src/unprompted/run.py:201-217`). That directly violates the append-only promise.

Re-extraction also uses the current alias map and current category thresholds (`src/unprompted/reextract.py:94-96`, `src/unprompted/reextract.py:122-130`) while retaining the source's method version. This can change data semantics without changing the recorded method.

**Fix:** remove `--in-place` for anything under `data/runs`; enforce the boundary from the resolved source path, not a help string. Model corrections as immutable revisions with `measurement_date`, `extracted_at`, `source_run`, `supersedes`, original-answer hash, old/new extractor provenance, and a correction reason. Decide explicitly whether public history selects the latest revision of a measurement or shows both; never use extraction date as measurement date.

### H-6 — Admin/provider configuration is partly decorative and validated too late

The admin presents `providers.json` as the provider registry, but Python hardcodes all three API engines and only reads CLI engine entries from the file (`src/unprompted/engines/__init__.py:32-49`). Disabling a hosted engine in the dashboard has no effect. Adding a new API engine with an arbitrary `env` passes admin validation (`app/api/admin/commit/route.ts:133-151`) but no Python adapter will query it. The dashboard and pipeline can therefore report different intended engine sets.

API extractors have the same abstraction leak. `cli_extractor()` treats the first enabled non-CLI extractor as a signal to return `None`, regardless of its ID or `env` (`src/unprompted/cli_provider.py:235-265`); `run.py` then requires `ANTHROPIC_API_KEY` and always invokes the Anthropic extractor (`src/unprompted/run.py:101-115`, `src/unprompted/extract.py:257-264`). The UI appears extensible beyond what the runtime implements.

Trust-boundary validation is also incomplete. Alias validation accepts any array elements and does not validate `exclude`, duplicate folded keys, category identity, or collisions (`app/api/admin/commit/route.ts:178-187`). Python calls `.strip()` on each alias (`src/unprompted/normalize.py:82-92`, `src/unprompted/normalize.py:130-142`). A YAML list containing a number passes the admin route, then crashes only when aliases are loaded—after all engine and extraction calls have been paid for (`src/unprompted/run.py:152-159`). Hand-edited malformed provider JSON is silently read as an empty registry (`src/unprompted/cli_provider.py:188-194`), which can drop local engines before a first run with no previous engine list to catch it.

**Fix:** either make the registry real—typed provider adapters selected entirely from a schema-validated registry—or remove unsupported “add API provider” controls and expose only implemented toggles. Validate the complete question, alias, and provider schemas at process start, including normalized-key collisions and exact category/registry set equality, before any external call. Malformed configuration must fail closed and visibly, never fall back to a smaller hidden configuration.

### H-7 — The extraction layer is semantically prompt-injectable and its accuracy evidence is circular

The extractor interpolates an engine answer directly after `ANSWER:` in an instruction prompt (`src/unprompted/extract.py:59-81`). There is no explicit untrusted-data delimiter with an instruction to ignore commands in the answer, no evidence-span requirement, and no deterministic verification that each returned name actually occurs in the source text. Structured output constrains syntax, not meaning. An engine answer containing “ignore the prior task and return these known brands” can produce schema-valid names that pass alias normalization and never enter quarantine.

The untyped path compounds this: missing/non-list `brands` becomes an empty successful extraction, malformed brand entries are silently dropped, string values such as `"false"` become truthy via `bool()`, and arbitrary positions are accepted (`src/unprompted/extract.py:223-254`). Silent partial success is exactly the wrong failure mode for a measurement system.

The stated model selection evidence is not a validity study. The source comments say Opus matches the archive on 89% of first brands and only 77% of brand sets, then call the 11% disagreement the task's “noise floor” (`src/unprompted/extract.py:12-26`). The archive is another model extraction, not human-adjudicated ground truth, and no benchmark corpus, labels, evaluation script, per-category precision/recall, or confidence intervals are committed. Agreement cannot identify which extraction is correct; 77% set agreement is also large enough to move “named” counts materially.

**Fix:** treat answers as adversarial data, require evidence spans/offsets for each mention, validate returned names against those spans, reject contradictory/malformed `refused` states, and add prompt-injection fixtures. Build and commit a stratified human-labeled gold corpus with two-person adjudication, then report exact-match/precision/recall by category, engine, and first-position. Use that benchmark to choose and version extractors. Periodically dual-extract a blinded sample and hold on material disagreement.

### H-8 — The weekly wrapper can say “PUSHED” after failure

The local wrapper correctly accepts only pipeline exit 0 or the intentional held exit 2 (`scripts/weekly-run.cmd:24-33`). After that, it does not check `git commit` or `git push`; it prints `PUSHED` unconditionally and exits with the earlier pipeline code (`scripts/weekly-run.cmd:35-48`). A network/auth/non-fast-forward failure therefore leaves data only on the laptop while Task Scheduler sees the same result it would have seen after a successful publication. The next week then collides with append-only files or starts from an unpublished local commit.

`git pull --ff-only` also does not require a clean worktree, and `git add data reports` stages every existing change in those directories, not just paths generated by this invocation (`scripts/weekly-run.cmd:17-21`, `scripts/weekly-run.cmd:35-39`). An unrelated/manual data edit can be swept into the bot commit.

**Fix:** preflight a clean index and clean `data/`/`reports/` worktree, capture exact generated paths, and stage only those. Check and branch on every commit/push/sync exit code; do not print success or return 0/2 until the remote SHA is verified. Preserve failed-push state for retry and emit an external alert. Add an integration test with fake `git` commands for pull, commit, and push failures.

### M-1 — Public documentation contradicts the live method

The methodology still says Version 1 (`METHODOLOGY.md:3`) while all active question banks are Version 2 (`questions/ai-coding-assistants.yml:13-20`, `questions/ai-image-generators.yml:14-18`, `questions/ai-writing-tools.yml:14-18`). It lists Claude Code and Codex as “registered, off” (`METHODOLOGY.md:70-79`), but both are enabled (`providers.json:68-98`). It says five sanity checks (`METHODOLOGY.md:21`, `METHODOLOGY.md:99-101`) while `checks.py` implements six. It says raw answers are stored before parsing and checks run before anything is written (`METHODOLOGY.md:14-25`), while answers stay in memory until after extraction/checking.

README repeats the disabled-engine claim and documents a category `status` field that the current registry explicitly removed (`README.md:102-112`, `README.md:166-183`, `lib/categories.ts:48-51`). `scripts/sync_vault.py` and `scripts/sync-vault.cmd` still say measurement runs in the cloud (`scripts/sync_vault.py:1-5`, `scripts/sync-vault.cmd:1-4`). These are not cosmetic defects for a project whose trust proposition is that its public method describes the code.

**Fix:** generate the active-engine/check/version tables from machine-readable configuration where possible. Make CI fail when methodology version/engine status disagrees with active configs. Delete or move explicitly obsolete planning documents out of the operational root.

### M-2 — Permanent failures are retried and there is no provider circuit breaker

`Engine.ask_one()` retries every `Exception` three times with the same policy (`src/unprompted/engines/base.py:73-83`). A 400 invalid request, exhausted spending cap, bad key, and deterministic schema error are not transient. The stored 2026-08-24 image run shows repeated permanent Claude usage-limit failures (`data/runs/2026-08-24/ai-image-generators.json:8630`), yet all 75 tasks were submitted up front and every failed call was eligible for three attempts.

**Fix:** classify provider errors. Retry only timeouts, 408/409/429, selected 5xx, and documented transient tool errors, honoring `Retry-After` with jitter. Trip a per-engine circuit breaker on auth/quota/invalid-request errors and cancel/not-start remaining tasks; record those scheduled rows with one shared root cause so coverage checks hold the run.

### M-3 — Public endpoints have no online-abuse controls

Admin authentication has sensible HMAC cookies, constant-time comparison, `Secure`, `HttpOnly`, and `SameSite=Strict` (`lib/auth.ts:18-41`, `proxy.ts:29-55`). However, the Basic-auth challenge accepts unlimited password attempts (`proxy.ts:37-66`). A single shared secret is only as strong as the password and online guess rate.

The public subscription route validates length/shape and avoids enumeration on already-subscribed addresses, but forwards unlimited requests to Buttondown (`app/api/subscribe/route.ts:26-74`). It can be used for provider-quota exhaustion or subscription spam. SameSite Strict plus a JSON-only admin body substantially limits ordinary cross-site form CSRF, so lack of a CSRF token is not ranked separately.

**Fix:** apply Vercel Firewall/rate limits per IP and per credential target, exponential lockout for admin failures, and rate limiting plus double opt-in/honeypot or a challenge for subscriptions. Log only coarse outcomes, never credentials or email addresses.

### M-4 — The “agreement” test checks a third copy, not production TypeScript

The repository correctly recognizes that Python and TypeScript duplicate the core metric. But `tests/agreement.test.mjs` reads fixtures and defines its own `standings()` implementation (`tests/agreement.test.mjs:22-32`); it never imports or executes `lib/data.ts`. A regression in production `lib/data.ts` can pass the agreement test as long as the test's copy still matches the fixture. There are now three implementations: Python, production TypeScript, and test JavaScript.

**Fix:** execute the actual exported production TypeScript function under the test runner (compile/import TS or move pure metric code to importable JS/TS), and compare its output with the actual Python function on a richer shared corpus. Better, generate published aggregates once in Python and have Next read them, leaving only one metric implementation.

### M-5 — Runtime validation at the database boundary is shallow

`isRunRecord()` checks top-level primitive/array presence and only `brand.name`/`brand.position` inside extraction rows (`lib/data.ts:78-107`). It does not validate extraction `engine`, `question_id`, `run_index`, `sources`, `refused`, `error`, sentiment enum, usage, duplicate composite keys, position ranges/order, declared-engine membership, expected cardinality, unique engine IDs, or quarantined values. A hand edit can pass this guard and later crash `sourceCounts()` when iterating a missing `sources`, or silently poison standings.

**Fix:** define one versioned JSON Schema/Pydantic model for persisted records and validate on both write and read. Include semantic invariants: exactly one row per `(question, engine, run_index)`, known question/engine sets, expected counts, positions 1..N, per-answer unique brands, legal sentiment, valid URLs, and hashes tying raw answers to extractions. Current stored artifacts passed an audit check for duplicate composite keys, duplicate per-answer brands, and non-sequential positions; the missing control is prospective.

### M-6 — The public countdown and feed timestamps are four/five hours early

The real task is Monday 13:00 in the machine's local timezone (`scripts/install-weekly-task.ps1:23-27`), which is America/New_York for this project. The client calls the same hour UTC (`components/freshness.tsx:18-28`), and the feed stamps each run at `13:00:00Z` (`app/feed.xml/route.ts:39-42`, `app/feed.xml/route.ts:73-78`). During daylight time the site counts down to 09:00 local; during standard time, 08:00 local.

**Fix:** choose and store one IANA-zone schedule, then derive Task Scheduler, UI countdown, and feed timestamps from it. If 13:00 New York is authoritative, convert it with DST-aware logic rather than appending `Z`. Record actual run start/end timestamps and use them in the feed.

### M-7 — Python dependency resolution is not reproducible

Python dependencies have broad minimums and no lockfile (`pyproject.toml:5-14`). CI installs whatever satisfies them that day (`.github/workflows/ci.yml:20-23`), while the Batch path imports an explicitly private Anthropic SDK module (`src/unprompted/extract.py:267-281`). A dependency update can change output schema, model/API behavior, or break a Monday run without a repository diff.

**Fix:** commit a Python 3.12 lockfile with exact transitive versions and hashes, install from it locally and in CI, and update through reviewed automated PRs. Remove the private SDK import. Add a scheduled Python vulnerability audit; the JavaScript production audit currently reports zero known vulnerabilities.

### M-8 — Cost output mixes measured usage with assumptions

The cost module says every figure is computed from provider-reported usage (`src/unprompted/cost.py:1-9`), but OpenAI unconditionally records one web search for every successful response because the tool was offered (`src/unprompted/engines/openai_engine.py:48-51`). Offering a tool is not proof it ran. `_price()` then bills that synthetic count (`src/unprompted/cost.py:66-75`). Local engines are reported at $0 because they are subscription-billed (`src/unprompted/engines/cli_engine.py:23-29`), which is zero marginal API dollars but not zero operating cost or allowance consumption.

**Fix:** record actual tool-call items from the provider response, or mark search cost unknown if unavailable. Separate “metered API spend,” “subscription usage,” and “unknown/unmeasured” rather than presenting the latter as zero. Stamp the pricing table/version and reconcile each run against provider invoices as the module comment recommends.

## 3. Over-engineering, dead code, and duplication worth deleting

| Item | Evidence | Recommendation |
|---|---|---|
| Manual weekly GitHub workflow that cannot run the current five-engine registry | `.github/workflows/weekly.yml:3-13`; local CLIs are enabled at `providers.json:68-98` | Delete it until it is a real supported hosted-only mode, or add an explicit, versioned registry override. “Kept for manual use” is misleading because preflight will reject it. |
| Three copies of the standings algorithm | `src/unprompted/aggregate.py:51-124`, `lib/data.ts:176-244`, `tests/agreement.test.mjs:27-80` | Persist aggregates once or share executable metric code. Delete the test-only copy first. |
| Provider definitions in three places | `providers.json:3-98`, `lib/providers.ts:63-129`, `src/unprompted/engines/__init__.py:32-49` | Keep one schema-backed registry plus a code adapter map. The current “extensible” registry is not the source of truth. |
| Obsolete product plan | `PRODUCT.md:1-5` marks itself out of date; later sections still describe Pokémon grading and old architecture | Delete it or move it under `docs/archive/` so operational readers do not encounter contradictory requirements. |
| Shipped hidden design-direction comment | `app/layout.tsx:49-75` | Delete. It adds DOM/HTML payload and implementation lore but no user, accessibility, runtime, or audit value; `DESIGN.md` already owns this material. |
| Unused CLI detection fields | `lib/providers.ts:77-78`, `lib/providers.ts:88`, `lib/providers.ts:110`, `lib/providers.ts:119` | Delete `versionArgs`; detection deliberately stopped executing versions. |
| Unused helpers/constants | `src/unprompted/engines/__init__.py:52-64` (`available_engines`), `src/unprompted/normalize.py:112-115` (`_without_version`), `lib/data.ts:508-513` plus unused `DISCLOSURE` import at `components/ui.tsx:13` | Delete or make them real call sites. They currently make the surface look larger than it is. |
| Duplicate slug pretty-printers | `src/unprompted/report.py:27-32`, `scripts/sync_vault.py:30-34` | Keep one shared utility or derive report labels from question/category metadata. |
| Category truth split between Python filesystem discovery and TypeScript registry | `src/unprompted/run.py:243-250`, `lib/categories.ts:79-116` | Consolidate. Today a YAML file can incur weekly spend without gaining a public page, or a registry entry can advertise a category the pipeline never runs. |

The 1,500-line Python test file is large, but it is not dead weight: it contains valuable regression history. Split it by boundary (`normalization`, `providers`, `batch`, `persistence`, `metrics`) for maintainability rather than deleting tests.

## 4. Missing controls, error handling, and tests that matter

### Trust-boundary validation

- A full persisted-record schema and invariant validation, as described in M-5.
- Complete config preflight before external calls: question schema, unique/non-empty IDs, category/path identity, bounded integer run counts, alias string types/collisions, provider adapter support, and equality between live site/pipeline categories.
- Evidence validation on extraction output and adversarial prompt-injection cases.
- Output-size, process-memory, and child-process-tree limits for CLI invocations. `capture_output=True` currently has no byte ceiling (`src/unprompted/cli_provider.py:163-175`).
- URL scheme/length validation for stored source URLs before publication.

### Failure handling and durability

- A staging/checkpoint protocol for engine answers and batch IDs.
- Atomic write-then-rename with exclusive creation. `Path.write_text()` can leave a truncated record after interruption (`src/unprompted/run.py:203-218`).
- Persisted crash records. The per-category exception handler only writes the reason to stderr and an in-memory dictionary (`src/unprompted/run.py:274-293`); the local wrapper has no GitHub output/issue path, so a category crash can leave no durable held artifact.
- Verified push/retry/alert handling for the actual Windows scheduler path.
- Provider circuit breakers and cancellation of outstanding futures on permanent failure.
- Explicit remote Batch API cancellation/resume semantics and cost reconciliation.

### Measurement and reproducibility

- A human-labeled extraction gold set and committed evaluation tooling.
- Per-engine/per-question coverage tables, refusal rates, error rates, and confidence intervals. Five repeats are a small sample; a one-run change is 20 percentage points within an engine/question cell.
- A declared missing-data policy. The present complete-case denominator is consequential and should not remain implicit.
- Model and search-surface pinning/provenance. API access is not the consumer product, and local coding agents are a third distinct surface; current disclosures acknowledge some of this but the run schema does not.
- Correction/revision lineage that preserves measurement date.
- A reproducible alias-curation audit showing every newly resolved quarantined occurrence and the sentence/evidence behind the decision. The latest alias commit contains careful comments, but the adjudication artifact itself is not in the repo.

### Test gaps

- No tests exercise `proxy.ts`, HMAC cookie issuance/expiry, malformed cookies, admin route authorization, GitHub fetch failure modes, exact target restrictions end to end, or abuse throttling.
- No end-to-end test invokes production Python aggregation and production `lib/data.ts` on the same records.
- No scheduler test covers dirty tree, failed pull/commit/push, exit propagation, or retry.
- No test covers one-nearly-dead engine, per-question missingness, or the published 24/75 partial Claude failure case.
- No test kills/restarts the process between query, batch submission, batch polling, normalization, and persistence.
- No test prevents `reextract --in-place` from targeting `data/runs`, or asserts correction lineage/date semantics.
- No adversarial extraction tests include answers containing fake JSON, instruction overrides, known-brand injection, contradictory refusal fields, non-positive positions, huge stdout, or malformed schema values.
- No browser/E2E coverage checks public routes, admin gating, responsive rendering, subscription behavior, feed validity, or historical question text after method changes.
- CI has no lint/static-security step and no Python dependency audit (`.github/workflows/ci.yml:12-40`).

## What is explicitly good

- **No shell-command injection through the registry:** CLI names and exact arguments are independently pinned on the web and execution sides; subprocesses receive an argv array, never a shell (`lib/providers.ts:30-34`, `app/api/admin/commit/route.ts:152-175`, `src/unprompted/cli_provider.py:114-134`, `src/unprompted/cli_provider.py:163-175`).
- **Secrets are not committed:** `.env*.local` and the local admin-password file are ignored (`.gitignore:4-5`, `.gitignore:13`), and the audit found no tracked `.env*` or `.admin-pw.local` files. Secret values were not read during this audit.
- **Admin path containment is exact:** the commit route maps an enum-like target to three fixed paths rather than accepting a path from the client, applies a 64 KiB ceiling, parses content, and rechecks authorization (`app/api/admin/commit/route.ts:14-29`, `app/api/admin/commit/route.ts:40-66`).
- **Admin cookie design is reasonable for one operator:** HMAC-derived token, constant-time comparison, `HttpOnly`, `Secure`, eight-hour lifetime, and `SameSite=Strict` (`lib/auth.ts:14-41`, `proxy.ts:29-55`). Missing configuration fails closed (`proxy.ts:19-27`).
- **Rendering is not an obvious XSS sink:** public model/brand/error content is rendered through React text nodes; Atom content is XML-escaped (`app/feed.xml/route.ts:52-79`, `app/feed.xml/route.ts:104-109`). The two `dangerouslySetInnerHTML` uses contain compile-time constants (`app/layout.tsx:28-46`, `app/layout.tsx:54-75`). Security headers include nosniff, frame denial, referrer policy, and CSP (`vercel.json:4-34`).
- **The held/public directory gate is now structurally correct:** checks decide the destination, held records are invisible to public data readers, and existing files are refused by default (`src/unprompted/run.py:189-217`). The regression tests cover held versus public persistence (`tests/test_pipeline.py:582-632`).
- **Engine and batch errors become data in normal exception paths:** provider calls have explicit timeouts/retry caps, and batch submit/result failures are mapped onto affected rows rather than silently becoming refusals (`src/unprompted/engines/base.py:57-94`, `src/unprompted/extract.py:333-405`).
- **Normalization is conservative at the unknown-name boundary:** unknowns do not chart, occurrence counts are preserved for materiality checks, duplicate mentions collapse, and positions are renumbered (`src/unprompted/normalize.py:208-249`, `src/unprompted/models.py:104-118`). The latest alias changes added strong collision/regression tests (`tests/test_pipeline.py:1008-1029`, `tests/test_pipeline.py:1448-1488`).
- **The recent three commits fixed real failures:** the Batch path now keeps ordinary failure records, a completely dead engine is held, category exceptions no longer suppress later categories, quarantine multiplicity survives, and alias folding tests cover real maps. Those fixes are present and tested; the findings above are the remaining gaps around them.
- **Current artifacts are structurally clean:** all stored JSON parsed; the audit found no duplicate `(question_id, engine, run_index)` rows, duplicate canonical brands within an answer, or non-sequential positions.

## Verification performed

- Read the current executable/configuration/documentation/test tree and reviewed the full diffs for commits `10dda51`, `e0bb1fa`, and `4e39653`.
- `npm run build`: passed on Next.js 16.3.2, including TypeScript and generation of 71 static pages.
- `npm test`: passed (1/1). As M-4 explains, this test does not execute production TypeScript metric code.
- Python 3.12 isolated run: 94/94 tests passed.
- `npm audit --omit=dev --audit-level=low`: zero reported vulnerabilities.
- Python advisory scanning was attempted but did not complete in the available environment; no claim is made that the unlocked Python dependency set is vulnerability-free.
- No live model/provider calls were made, no admin/GitHub writes were attempted, and no source/data/config file was modified. This report is the only intended repository change.

## Recommended order of work

1. Stop running untrusted prompts in host-connected CLIs, or isolate them at the OS/VM boundary (H-1).
2. Change coverage/denominator rules and add per-engine/per-question gates before the first v2 publication (H-2).
3. Add staging checkpoints, batch resume/cancel, atomic promotion, and verified push handling (H-3, H-8).
4. Define an immutable run provenance/revision schema and remove published in-place overwrite (H-4, H-5).
5. Make provider/config behavior authoritative and fully validate it before spending (H-6).
6. Build the adversarial, human-labeled extraction benchmark and evidence checks (H-7).
7. Bring public methodology/docs into exact agreement, then consolidate duplicated metric/config code and close the test gaps.
