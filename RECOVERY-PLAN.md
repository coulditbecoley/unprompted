# Recovery plan: weekly analytics (final, 2026-10-28; reviewed with Codex over 5 rounds, approved)

## What happened

Nothing has been published since 2026-09-14. The weekly task fired every Monday
on the operator machine; every week ended `held`, `failed` or `refused`.

| Week | Outcome | Cause (evidence) |
|---|---|---|
| 09-21 | failed | publication preflight: `git push --dry-run` failed (auth). The alert also failed (GitHub 401, log 623–630): **undelivered**, not ignored |
| 09-28 | held ×3 | coding/images: unaliased brands. writing: engine answers fine, but Anthropic **rejected the extraction batch submission** (HTTP 400, "reached your specified API usage limits") → 450 extraction errors |
| 10-05 | refused ×3 | that known HTTP rejection was persisted as an "ambiguous" id-less batch → guard refuses all paid work |
| 10-12 | held ×3 | unaliased brands; Gemini source coverage 40/75, 16/75, 9/75 (floor 60%) |
| 10-19 | held / failed | coding: aliases + Gemini 29/75. images: `batches.retrieve()` hit WinError 10054 with `max_retries=0` → category died, batch stranded. writing: refused on that batch |
| 10-26 | refused ×3 | 10-19 batch still uncollected; nothing auto-collects a prior week's batch |

Root causes:
1. **Recoverable states are treated as permanent blockers across weeks**: a stranded
   batch with an id (10-19), and a definitive HTTP rejection stored as "ambiguous" (09-28).
2. **Gemini source coverage collapsed from ~98% to 12–53% from 10-12.** Cause unproven:
   the adapter discards the raw response, `modelVersion`, `finishReason`, and does not
   distinguish missing from empty `groundingMetadata`.
3. **Alias decisions not made** (coding held on aliases 09-28, 10-12, 10-19).
4. **Provider capacity exhausted** on the Anthropic account 09-28 (limit amount unverified;
   could be the console cap or shared usage).
5. **Alerts unreliable**: one undelivered (401), the rest piled up as separate issues.

## Done already (this session, uncommitted)

- Collected the stranded 10-19 image batch (download only). Local accounting now
  succeeds ($79.48 October). The 09-28 writing `batch.json` is no longer present; how it
  was reconciled is unrecorded and will be noted in the recovery log.
- `collect()` retries transient errors on the status poll.
- `collect_outstanding()` at the top of `run.main` downloads every uncollected batch with an id.
- Regression test added. Verified: `.venv/Scripts/python.exe -m pytest -q` → 218 passed on 556d4ef + diff (Codex independently ran the 48 batch/recovery tests).

## Status (2026-10-28, branch `recovery-weekly-analytics`)

Implemented and reviewed by Codex: step 1 (batch recovery), step 3 B0–B3 (Gemini
evidence and per-query billing), step 6 minimum (watchdog alarms on held-but-unpublished
weeks; early-abort failures already stay local in `notify.py`), and gate F (next 16.4.3,
sharp 0.35.5, source-map-js 1.2.2). Verified: 230 Python tests, 35 web tests, typecheck,
build, `npm audit --omit=dev` 0. Recovery against the real `.unprompted` finds nothing
outstanding. Waiting on the decisions below: aliases, Gemini method, B4 sample, G-min.

## Plan (in implementation order)

### P1 — before Monday 11-02

**1. Batch recovery (A).** No new paid requests in this step.
- A1 `collect_outstanding` returns structured results (collected / failed with reason)
  to `main()`; parse errors, download failures and lock failures are reported through
  the normal outcome/summary path. A job whose accounting is unknown stays and keeps
  blocking new spend.
- A2 One shared deadline (≈45 min) across initial retrieve, polling and the results
  download, for Claude and extraction (normal + reextract) batches. Expiry leaves the
  job unresolved and blocks fresh paid work.
- A3 Bounded retry of the results download; `results.json` still written only after a
  complete download.
- A4 Extraction `batch.json` jobs with an id get the same auto-collection.
- A5' Files: `engines/anthropic_batch.py` (`collect`, `collect_outstanding`),
  `extract.py` (`_batch_entries`, `collect_batch`), `run.py` (`main`), `reextract.py`
  (`_main`), `run._run_category` (same-date recovery uses the same deadline), both
  `_client` timeouts, and the standalone collector entry points. `read_batch_results()` stays local and read-only (budget and `--preflight`
  must never contact providers). Extraction completion = validated
  `extraction-batch/results.json`; scan both `????-??-??/*/batch.json` and
  `reextract/????-??-??/*/batch.json`. The 45-min deadline covers only the recovery
  phase, never new Monday batches.
- A6 Tests: (a) `collect_outstanding` alone on a stale job — zero submissions, spend
  equals the expected amount, unchanged on a second collection; (b) `run.main` with a
  fully cached current week, so any submission is a failure; (c) malformed state,
  failed download, expired deadline, id-less state, lock failure. The cached
  `main()` fixture has engine + extraction checkpoints, no `data/runs`/`data/held`
  destination, and stubbed CLI identity probes.

**2. Aliases (C1).** Operator decides the recurring names in one PR before Monday.

**3. Gemini evidence (B1–B4).**
- B0 Stored as an optional `metadata` field on `EngineAnswer` and `Extraction`,
  **omitted from `to_dict()` when absent** so old Claude checkpoints still compare equal
  in `ask_batch`/`collect` (tested against an old-format fixture). Not in `usage`
  (numeric only). Absent / null / `{}` preserved distinctly. Carried through
  `_one_call` (all five adapters return it; never stored on `self`, engines are
  shared across threads), `base.ask_one`, `extract._base_for`, `reextract._main`,
  `jev_reader.stored_answers`, and `anthropic_engine.read_response()`'s second
  caller in `anthropic_batch.collect()`; declared optional in `lib/metrics.ts`. Web consumers
  ignore unknown fields (checked: `lib/data.ts::isRunRecord`, `app/questions`).
- B1 Persist per answer: raw `groundingMetadata`, `modelVersion`, `finishReason`,
  `promptFeedback`, `webSearchQueries`. Blocked prompts may have no candidate at all.
- B2 Blocked/truncated → engine failure, usage retained.
- B3 New Gemini records put the query count in `usage.web_searches` and never write
  `requests`; `cost.py::_price` and `lib/metrics.ts::price`, and the search line-item counters in `cost.py::cost_of_run`
  (line 147) and `lib/metrics.ts::costOfRun` (line 656), switch from truthiness
  (`web_searches or requests`) to field presence so an explicit 0 is 0. Tests: legacy
  `requests`, multiple queries, explicit zero, failed answer, re-extraction (no engine
  re-charge). Fix the per-prompt wording in `data/rates.json`. No historical repricing.
- B4 Diagnostic sample (needs operator OK — paid): ≤10 calls, no retries, output
  tokens capped; ~$1 is a **target with possible overrun** (the fixed prompt bounds input tokens, but search queries
  per call are not boundable in advance); stop after the first call that crosses it, recorded outside the measurement
  population. It shows response shapes, not a coverage estimate or causation.

**4. Gemini method decision (B5), before Monday.** Options, each a `method_version`
bump: a dated model id (only if one is actually offered), a stronger grounding
instruction, or disable Gemini in `providers.json` and bump `method_version` in each affected
question bank. If none is
chosen, Monday may hold again on Gemini coverage, and that hold is correct.
(For scale only: under an independence assumption one blind retry takes 12% to ~23%.)

**5. Paid-retry safety, Monday subset (G-min) — operator decision.**
Trade-off: fewer duplicate charges, but a transient read failure that a retry used to
rescue now stays failed, so more answers fail and a category is likelier to cross the
20% error hold. Residual risk without G-full: a crash after a POST but before the
answer is saved can resend it on restart; unknown spend stays outside the budget.
- Paid POSTs: SDK and urllib redirects disabled; SDK retries stay 0.
- Retry only when the typed cause proves no application request was sent on the
  **first, unredirected** attempt: `httpx.ConnectError`/`ConnectTimeout`/`PoolTimeout`
  (OpenAI) and the `httpx2` equivalents (Anthropic), via `exc.__cause__`; urllib
  `URLError.reason` of `socket.gaierror` or `ConnectionRefusedError`. Everything else —
  read/write timeouts, `RemoteProtocolError`, generic `APIConnectionError`, SSL, OSError,
  string reasons — unless already classified as a documented rejection below — fails the answer as `ambiguous` (usage unknown, not 0), no retry.
- 429: retry only an allowlisted rate-limit body, honouring `retry-after` within a bound;
  quota/spend-cap bodies and unknown bodies are engine-wide failures, not retried.
- `CliEngine` gets an explicit `is_retryable` that keeps today's behaviour.
- `extract.extract_one`: `max_retries=0`.
- Gemini/Perplexity: parse error body; dispositions **request-local**, **engine-wide**
  (auth, quota, model not found → stop the engine's queued calls **for the rest of the
  weekly run**, recorded on a run-level set, not the per-category instance; in-flight
  calls may still finish) or **ambiguous**.

**6. Minimum reliable alerts (E).**
- Watchdog alerts on unresolved held/failed weeks too, not only missing measurements
  (`scripts/watchdog.py:177` currently passes an all-held week).
- Early-abort failures stay in `.unprompted/last-attempt.json` (never dirty tracked
  `data/`). A run that reaches publication writes `data/last-run.json` before its commit
  and is treated as delivered only after the push is verified.
- Recovery commands are generated from known blocker types, never from exception text.
- If the blocker never reached GitHub, the watchdog says "evidence missing", not an old command.

**Security gate (F).** Verify next/sharp/source-map-js advisories against installed
versions and our usage (image optimisation, `use cache`, server actions); upgrade to
patched versions before the next deploy, independent of the analytics order.

### P2
- **G-full. Durable attempt ledger**: record intent before each paid POST and
  completion after, in a dedicated `attempts/` subdirectory with its own reader (the
  budget reader assumes every category-level `*.json` is an answer). `budget` refuses
  new spend while any attempt is unresolved, including after the category is archived,
  without double-counting archive + ledger. Reports show unknown spend as unknown.
- **D. Live readiness probe**, depends on **G-full** (durable probe attempts). Order: git/publication + config checks →
  collect outstanding → budget admission for probes → bounded probes with durable
  attempt records → recompute budget. Each probe states what it exercises (auth,
  search, extraction, batch create) and is paid, accounted and, once the launcher runs
  it, scheduled. CLI identity probes reused, not repeated, within a run.
- **CLI engines**: confirm a 180 s timeout kills the child process tree (10-12 images
  had a Claude Code timeout); probe login + successful exit under the scheduler's env.
- **A5. Rejected vs ambiguous**: mark an attempt rejected only for an allowlisted,
  documented rejection from the create request (e.g. Anthropic HTTP 400
  `invalid_request_error` usage-limit), keep the attempt record and request id, never
  auto-resubmit. All else ambiguous. Until then ambiguous jobs stay operator-reconciled.
- **Rolling alert issue** with a stable identity; close old issues only after their
  unresolved blockers are carried forward.
- **Historical recovery** (paid, published as dated re-readings, not guaranteed):
  09-28 coding, images and writing (Gemini coverage was fine then). 10-12 / 10-19
  cannot pass the current method through alias fixes and re-extraction alone.
- **Actions** off Node 20.

## Decisions for Coley (not code)

1. **Aliases**: canonical / alias / exclude for Lovable, Junie (JetBrains AI), Google
   Gemini, Bolt, Forge, Supermaven, Google Antigravity, Claude 3.5 Sonnet, GitBook, Writer.
2. **Gemini method**: keep and accept holds, change instruction, pin a model, or drop Gemini.
3. **Diagnostic spend**: approve the ~$1 Gemini sample (B4).
4. **G-min**: accept the fewer-duplicates / more-holds trade-off for Monday, or wait for G-full.
5. **Provider limits**: Anthropic console limit vs the $350 internal ceiling and other
   usage on that account.
6. **Historical re-reading**: which 09-28 categories are worth paying to re-extract.
7. **Ambiguous submissions**: reconciled by hand from provider console evidence.

### Not proposed
Auto-dropping a failed engine to publish anyway (a method decision); moving the run to
GitHub Actions (two engines are signed-in local CLIs).
