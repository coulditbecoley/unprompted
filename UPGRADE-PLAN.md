# End-to-end upgrade plan — 2026-09-14

Preserve the current working tree and all historical measurements. Implement the
2026-09-14 audit recommendations and the subsequent audience review in these phases:

1. Secure dependencies; make publication append-only and atomic; checkpoint paid
   answers; validate extraction and measurement identity; correct recovery/budget
   behavior and scheduler failure handling.
2. Correct analytics collection, archive accounting and unavailable states. Use a
   consistent weekly audience scorecard, separate diagnostics, exclude operator
   browsing, and label browser events and self-declared agents honestly.
3. Harden admin authentication, configuration and concurrent edits; include held
   attempts in operations; support category selection and explicit runtime scope.
4. Add dated evidence navigation, accessible question inspection and honest
   freshness/source/statistical labels; reduce unnecessary payload and reads.
5. Run isolated regression, integration, type, build and dependency checks. Inspect
   desktop/mobile UI, fix observed defects in one pass, and record remaining external
   prerequisites separately from local acceptance. Do not send test messages or run
   paid measurement jobs to validate code.

Implementation results and any residual audit items will be recorded here. A local
pass does not establish production deployment or provider delivery.

## Resume checkpoint: 2026-09-14

Recovered session `01a0a034-21d7-7ed0-bd0e-05f374dd56d4` after its authentication
failure. Existing implementation and unrelated working-tree edits were preserved.

The recovered implementation includes the weekly audience scorecard, unavailable
states, operator exclusion, crawler diagnostics, editor conflict detection, dated
chart routes, raw-answer inspection, atomic publication, answer/batch checkpoints,
and patched runtime dependencies. These are working-tree changes, not a release.

This continuation added publication path validation, checkpoint answer identity
validation, and exclusion of extraction-only re-reads from fresh-run cost estimates.
Added isolated regression coverage for overwrite refusal, interrupted JSON writes,
exclusive job locking, extraction-failure restart without repeated engine calls,
changed/corrupted checkpoints, partial-category continuation, budget estimation,
and expiring/tampered admin sessions.

Validation:

- `python -m pytest -q`: 133 passed; the final expanded checkpoint test also passed
  in a subsequent targeted run of all four recovery tests.
- `npm test`: 13 passed, including Python/TypeScript agreement and session checks.
- `npm run typecheck`: passed.
- `npm run build`: passed on Next 16.3.5, 77 generated pages.
- `npm audit --omit=dev --json`: zero reported vulnerabilities.
- `git diff --check`: passed, with repository line-ending warnings.

End-to-end acceptance remains incomplete. Automatic approval review rejected the
local Next server launch as "blocked by policy" without further detail. Therefore
this continuation could not verify desktop/mobile interaction, authenticated HTTP
flows, or the namespaced Redis integration contract. No production deployment,
provider delivery, GitHub write, or paid model job was performed.

Remaining review must also reconcile all 30 audit findings against the final diff;
passing the existing suite is not proof that every proposed item was implemented.
In particular, preserve and account for earlier extraction spend during held-run
in-place recovery, verify recovery batch identity and budget behavior, and exercise
editor conflict and analytics ingestion cases through the real HTTP entry points.
The original audit report remains a dated pre-implementation artifact.

## Continued implementation: 2026-09-14

Recovery now always creates a new dated reading. `--in-place` refuses before paid
work, and the shared writer rejects replacement of held as well as published
records. This preserves both the original engine cost and every recorded
extraction attempt without introducing another datastore. The existing limit of
one reading per category/output date remains. Re-extraction uses the same lock
and conservative budget check as fresh measurement; it preserves original
grounding metadata when available and freezes the new extractor/alias provenance.

Batch checkpoints now bind the full request payload and answer identity. Matching
restarts retrieve the saved batch; a mismatched or legacy checkpoint cannot trigger
a replacement submission. Malformed or truncated responses retain reported usage.
Provider quota/auth failures suppress later queued calls on that engine instance;
already running calls may finish. Budget accounting includes saved engine answers
that have not reached a held/published record, without counting them again afterward.

Actual route handlers now have an in-process integration check using real Request
objects and the Redis SDK with intercepted transports. It covers view/click
separation, operator exclusion, malformed and foreign-origin input, unavailable
analytics, stale editor conflicts, successful conditional saves, target allowlists,
question identity, provider credentials, and alias collisions. No real Redis or
GitHub write is involved. These checks are part of `npm test`.

Additional corrections: declared engines with missing answers cannot disappear
from consensus; homepage and chart navigation use measurement chronology; homepage
question text uses frozen provenance when available; sharing retains the dated
result; reports and feeds distinguish measurement from re-reading; freshness
updates when its date changes. Both board entry points omit unused per-answer
cells. On four published records, serialized standings fell from 120,645 to 20,479
bytes (83.0%); this is component-data serialization, not a measured HTTP payload or
page-load speedup. Raw results are in `audit/2026-09-14/upgrade-payload.json`.

Python dependencies are pinned in `requirements.lock` and used by both Python CI
and the weekly workflow. Qualification uncovered global OpenAI SDK 3.3.1 outside
the declared `<3.0` bound. The isolated dependency set resolves OpenAI 2.54.0 and
Anthropic 1.5.0. The Windows weekly entry point now requires the project `.venv`
rather than relying on global Python packages. No scheduled paid run was launched.

### Audit disposition

“Implemented” below describes local code, not deployment or live acceptance.

| Finding | Local disposition | Acceptance limit |
|---|---|---|
| F01 dependencies | Patched Next/Sharp, production npm scan and pinned Python set | Hosted versions and Python advisory coverage not certified |
| F02 overwrite | All final readings immutable; unsafe in-place option retired | One output date per reading remains |
| F03 recovery | Atomic answer checkpoints and input-bound batch IDs | Provider submit-to-ID crash window still needs provider reconciliation |
| F04 partial categories | Refusals caught per category; later work continues | Actual scheduled commit/push not exercised |
| F05 method identity | Frozen provenance, population checks and checkpoint guards | Missing provenance in legacy records cannot be reconstructed |
| F06 audience archive | New-format totals read from actual counters | Live vault/Redis reconciliation not run |
| F07 held operations | Held records included in admin costs and health | Hosted rendering not verified |
| F08 budget | Immutable readings, extraction-only re-read pricing, failed-run fallback, pending-answer costs, locked preflight | Estimated usage is not an invoice; unknown provider-side billing still requires reconciliation |
| F09 stale edits | Baseline comparison and GitHub conditional write; client preserves edits made during save | Provider/method edits remain separate commits; pipeline refuses incompatible methods |
| F10 validation | JSON providers, target/category/ID/type/range/credential and alias-collision guards | Full cross-language configuration corpus remains desirable |
| F11 contrast | Shared meaningful-text tokens corrected | Real desktop/mobile/theme inspection still required |
| F12 input access | Native question selection and focus/touch path | Browser acceptance blocked |
| F13 test isolation | Live contract requires explicit test credentials and matching namespace; offline route transport isolated | Real namespaced Redis contract not executed |
| F14 CLI extraction | Resolver refuses unqualified local extraction | OS isolation qualification required before enabling |
| F15 chronology | Original timestamps, measurement-order history, dated UI/report/feed labels | Legacy source dates remain as recorded |
| F16 malformed responses | Strict parsing, duplicate IDs, completion guards and retained usage | Real provider response contracts not live-tested |
| F17 retries | Permanent-fault ordering, queued-call suppression, monotonic batch wait and saved ID | Windows CLI descendant lifetime and uncertain provider billing still unqualified |
| F18 analytics drift | Counter-format fix, per-field archive retention, frozen agent metadata, quarantine normalization | Historical resets require operator reconciliation |
| F19 analytics boundaries | Body/path bounds, missing-path grouping, operator/404 exclusion, bounded reads, explicit totals outage | Diagnostics are not a proof of complete capture |
| F20 scheduler state | Failure status local, success labeled measured, staged-work guard and sync exit propagation | No real scheduler/push/deployment acceptance run |
| F21 watchdog | Catch-up week window, injected observation time and checked issue command | Declared categories are due immediately; no onboarding grace policy added |
| F22 evidence | Dated routes/shares/feed links, raw answers and staleness labels | Browser walkthrough still required |
| F23 forms | Truthful browser/provider/inbox labels, deadlines and fallback copy | Subscriber additions and delivery require provider reconciliation |
| F24 operating scope | Category selection, server-local readiness labels, hosted-only extractor selection | Remote runner status is not available from hosted configuration alone |
| F25 statistics | Ties and absent engines unresolved, genuine majority, sample-aware dropout | No claim of validated causal or stratified uncertainty model |
| F26 provenance | Typed retrieved/cited evidence and frozen affiliation/reader labels | Legacy/Gemini source identity cannot be recovered; Gemini remains unqualified |
| F27 CI | New guards run in CI, pinned Python versions, safe watchdog input, longer job timeout | Hosted CI and cross-platform lock installation not yet observed |
| F28 payload/reads | Memoized history, shared audience totals and smaller board props | Serialization measured; real network/read-count benchmark not performed |
| F29 auth | Signed expiry, malformed-cookie refusal and bounded local login throttle | Deployment-wide edge limits not certified |
| F30 explanations | Removed active claims about CLI fallback, noise floor and fixed check counts | Historical narrative and harmless compatibility helpers retained |

End-to-end release acceptance is still open. The earlier automatic approval review
rejected starting the local server as "blocked by policy"; no browser or live HTTP
server pass is claimed. Isolated route integration does not replace that check.
No external messages, GitHub changes, deployment or paid measurements were
performed during this continuation.

### Final local checks for this continuation

- Project `.venv`: installed from `requirements.lock`; `pip check` reports no
  broken requirements.
- `.venv\Scripts\python.exe -m pytest -q`: **139 passed**.
- `npm test`: **21 passed**, including the route integration group.
- `npm run build`: passed, **77 generated pages**, including TypeScript checks.
- `git diff --check`: exit 0; line-ending warnings only.
- Historical measurements were not edited. No commit or deployment was made.

Current source hashes and this verification scope are recorded separately in
`audit/2026-09-14/upgrade-verification.json`. The original audit artifacts remain
unchanged. Browser, real Redis, hosted CI, deployment and provider-delivery checks
remain unverified for the reasons above.
