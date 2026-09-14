# Upgrade loop

Work one evidenced problem at a time: inspect the real path, implement the
smallest useful change, run a check that can fail, record the result, then
re-rank the remaining work. Local checks and live acceptance are separate.
Preserve archived readings. Do not turn this loop into automatic paid runs,
notifications, or deployment.

## Next candidates, in priority order

1. **Measure extraction accuracy.** Produce a reproducible review sample tied
   to exact saved answers and extraction versions. Human adjudication must
   remain explicitly pending until someone supplies labels. Report missed and
   unsupported recommendations separately; model agreement is not accuracy.
2. **Explain weekly changes.** Give readers a short, source-linked account of
   movement, sample coverage, changed methodology, and stale measurements.
   Suppress comparisons when the underlying measurements are not comparable.
3. **Improve recovery visibility.** Separate historical held attempts from
   published replacement readings using explicit source lineage. Surface
   unreadable records rather than silently hiding them.
4. **Verify the actual reader journey.** Desktop, mobile, keyboard, dated
   evidence links, forms, and failure states need browser acceptance. Hosted CI,
   real isolated Redis, and provider delivery remain separate acceptance tasks.
5. **Learn what readers need.** Use existing privacy-bounded analytics to
   identify evidence usage and abandonment; validate usefulness with actual
   reader feedback before expanding categories or adding personalization.

## Integration and acceptance gate — current isolated branch

The cycle ledger below supersedes the original candidate list where work is
already implemented. Local tests establish behavior in their stated scope, not
release acceptance. Remaining work is:

1. Observe the September 14 scheduled task through its terminal state. Record
   each category's published/held/refused outcome, stored reasons, commit/push
   result, and any budget refusal. A progress counter is not publication proof.
2. After the task is terminal, inspect both worktrees and any new scheduler
   commits. Preserve all new measurements and the runner's stamped code revision.
   Integrate the isolated branch only then; resolve conflicts against the final
   measurements and code, not the pre-run snapshot. Recheck scheduler guards and
   an empty index after integration.
3. Validate the integrated tree with its Python suite, Node agreement/route
   checks, typecheck, and production build. The newly generated readings must
   participate in the existing cross-language checks. Inspect hosted CI and
   deployed revision separately from local build output when they exist.
4. Complete desktop/mobile/keyboard and authenticated reader/operator journeys.
   Local server launch was rejected by automatic approval review; do not treat
   in-process server rendering as browser acceptance or bypass that rejection.
5. Obtain independent labels for the saved-answer review packet and score it.
   All 75 labels remain pending; no extraction-accuracy result is available.
6. Reconcile real provider billing and namespaced analytics/delivery evidence
   before claiming those external contracts are qualified. No test outreach or
   additional paid measurements are authorized by this checklist.

Potential implementation follow-ups still need evidence: code provenance across
resumed checkpoints, complete cross-language configuration validation, and reader
feedback on evidence navigation. Avoid adding new categories or personalization
without evidence that they improve the service.

## Cycle 1: retain publication decisions — 2026-09-14

Problem: publication checks choose held versus published storage, but their
reasons disappear from the saved record. Admin exposes only call error rate,
which does not explain holds caused by coverage, aliases, or methodology.

Change: the shared publication writer stores its pass/fail decision and exact
reasons atomically with every new reading. Admin displays the saved reasons.
Older records explicitly say reasons were not recorded; no historical record
is rewritten or retrospectively judged using current checks.

Verification: 139 Python tests and 22 Node tests passed; production build passed
with 77 generated pages. Checks cover stored pass/fail decisions, legacy missing
reasons, malformed reason entries, and preservation of immutable readings.
Browser rendering remains unverified because the earlier automatic approval
review rejected the local server start as "blocked by policy".
Historical verification hashes in audit/2026-09-14/upgrade-verification.json
describe the preceding checkpoint and are not hashes of this cycle's edits.

## Release priority: scheduled run — 2026-09-14

Before the 13:00 local run, commit the entire dependent upgrade set, including
storage.py and requirements.lock. alias-plan.md is operator scratch material,
locally ignored and excluded from the commit.

Writing version 3 now resolves two ambiguous names from narrow answer evidence.
Same-line product citations can establish Writer.com. Explicit Mail or email
client descriptions establish Superhuman Mail; reviewed parent-only wording is
excluded. Missing evidence remains quarantined, and the 2% gate is unchanged.
Offline probes over the September 7 answer text are recorded in
audit/2026-09-14/writing-context-review.json. They are not a paid re-extraction or
a guarantee that the next run publishes. Tests: 140 Python, 22 Node passed.

Freeze method/code edits during the scheduled measurement. Resume the broader
upgrade queue after the task finishes; do not make the runner's stamped commit
diverge from the code it executes.

## Cycle 2: make reading accuracy reviewable — isolated worktree

Added a stdlib-only preparation/scoring workflow and a blinded 75-answer baseline
from the September 7 held records. Sampling is deterministic within category and
engine groups. Error/empty rows are counted separately. Scoring regenerates the
sample against source hashes, rejects edited evidence and invalid labels, and
withholds metrics until review is complete. It evaluates the saved normalized
readings, not the current extractor in isolation. No human accuracy result exists
yet. Instructions: READING-REVIEW.md.

This cycle lives on upgrade/extraction-review while the scheduled checkout stays
at af06305. Do not merge it during the scheduled run. No paid calls or historical
data changes are needed to prepare or score the review.

Verification: 142 Python tests passed in the isolated worktree. The actual CLI
prepared and scored the 75-answer packet as awaiting_review with null metrics;
an attempted overwrite was refused. Three error/empty answers were excluded.
Historical data and the scheduled checkout were unchanged.

## Cycle 3: reject disappeared engines in legacy recovery

Confirmed with a failing regression: deleting every answer from one declared
engine in a legacy record still passed the publication checks. The full population
check depends on a frozen question manifest, which those older records lack.
The shared per-engine check now holds any declared engine with no recorded calls.
Fresh measurement and re-extraction use that same gate. Version-change fixtures
now include rows for every engine they declare, preserving their intended tests.

Verification: regression failed before the fix; 143 Python tests pass afterward.
All nine current archived held/published records retain at least one row for each
declared engine. This closes an exposed validation gap; it does not claim that
an existing archived record suffered it. No historical records were changed.
The fix is isolated on upgrade/extraction-review pending the scheduled run.

## Cycle 4: use the alias policy that the reading records

Measurement previously saved an early alias snapshot but reloaded the live file
after extraction. Recovery loaded its aliases and publication threshold only
after extraction. An operator edit during the wait could therefore change the
interpretation after spending, and measurement could record different aliases
from those actually used. Both paths now validate and retain the alias map before
calls; recovery also retains its check threshold. Both stamp the starting commit.

Verification: 145 Python tests passed. Two offline integration cases deliberately
edit aliases, the question-bank threshold, and the reported Git revision during
extraction. Measurement and recovery both retain the starting alias provenance,
canonical names and commit; recovery preserves its source file. No paid calls
were made and the main scheduler checkout remains unchanged.

Follow-up: audit consumers' handling of an explicit alias snapshot with no
affiliations. Falling back to current affiliations in that case would reinterpret
an intentional absence of ownership metadata.

## Cycle 5: retain recorded ownership metadata, including its absence

The report and chart previously fell back to current affiliations when a saved
alias snapshot lacked that field. Both now read through their existing shared
affiliation loaders, where an explicit snapshot wins even if empty. Only a legacy
record with no alias snapshot uses the current-map fallback. This prevents later
ownership-map edits from adding self-preference claims to frozen readings.

Verification: 146 Python tests, 23 Node tests, and the isolated production build
passed (77 generated pages, including TypeScript checks). Tests cover missing
versus empty snapshots, archived scalar/list ownership, and the report's actual
self-preference section. Browser rendering remains unverified. Dependencies were
installed from the existing lockfile in the isolated worktree; main was untouched.

## Cycle 6: show only comparable changes, against a dated baseline

Homepage, category and dated charts, Atom feed, and generated reports now suppress
movement when recorded methods, engine rosters, repetition counts, question
coverage, or shared frozen reading configurations differ. Same-measurement
re-readings are not temporal comparisons. Legacy comparisons rely on declared
metadata; absent provenance cannot certify unchanged provider behavior.

Readers see the reason comparison is unavailable or the actual baseline date;
chart baseline dates link to the immutable prior reading. A multi-week gap is no
longer described as last week. The publication swing check also skips incompatible
measurements, while all population, failure and quarantine checks remain active.
Dropout headlines now honor the existing sample-support flag, which their prior
special case ignored. Numerical movement remains visible when comparable; an
unsupported disappearance does not become a headline.

Verification: 148 Python tests and 25 Node tests passed. The cross-language test
checks incompatible and compatible cases, including reordered metadata keys.
Report integration checks both method-change suppression and dated comparisons.
The production build passed with 77 pages; generated homepage and chart HTML
contain the no-baseline explanation. This is generated-output evidence, not a
browser interaction or hosted deployment pass. Main remains frozen for 13:00.

## Cycle 7: make the held review list actionable

The admin held list now uses the archive's existing validated scanner. Invalid
JSON and mismatched file identities remain visible as explicit file errors;
records with zero calls have an unavailable error rate, not 0%. Published rereads
link back from their held ancestors, including multi-step recovery chains.
An unrelated newer measurement does not resolve an older hold. Missing parents,
cross-category links, inconsistent measurement dates, cycles, and ambiguous
source identities do not produce a recovery link. Historical attempts remain
visible alongside the link to the latest published rereading.

Verification: 26 Node tests and the 77-page production build passed. Offline
archive fixtures cover each refusal and recovery case without writing to data/.
The Python source is unchanged from its preceding 148-test pass. Actual admin
browser rendering is still unverified; this cycle is isolated from the runner.

## Cycle 8: refuse irreparable recovery inputs before spending

The structural checks now have one shared entry point, used by the publication
gate and by recovery before extractor resolution. Empty sources, absent declared
engines, and frozen population mismatches cannot consume another extraction
batch in an attempt to repair missing answers. Legacy records without a frozen
question manifest still cannot prove full question/repetition coverage; this
change does not invent it. Recovery output dates must be canonical YYYY-MM-DD,
later than their source reading, and no later than today.

Verification: 154 Python tests and 26 Node tests passed. Offline refusal cases
cover missing/duplicate/unexpected rows, empty sources, missing engines, compact
dates, backdating and future dates. The extractor is never resolved in those
cases, and source bytes remain unchanged. No measurement or paid recovery ran.

## Cycle 9: inspect the whole week without making provider calls

Added `python -m unprompted.run --preflight --category all`. It reports local
provider configuration, destination collisions, category answer counts, and one
combined budget projection from the existing cost estimator. It does not write
measurements/checkpoints or GitHub output, and cannot combine with paid dry-run
or budget-override flags. It does not claim live credential, checkpoint, Git or
publication acceptance. Existing scheduled per-category behavior is unchanged.

Verification: 155 Python tests passed, including a case where each category fits
individually but the aggregate estimate exceeds the ceiling, plus existing output
and unreadable budget cases. The isolated CLI correctly reports its absent API
credentials and the $153.1127 aggregate projection against $150. No production
credentials were copied into this worktree. Main and its budget remain unchanged.

## Cycle 10: keep history charts honest across method changes

Brand and head-to-head history charts now reuse the comparison guard to break
their SVG paths between incompatible readings. Dots retain every measurement,
including isolated points and true zero mentions. History dates identify the
measurement; brand history links to the exact published reading, including a
later reread. The table explains method breaks, and both charts disclose their
equal spacing by measurement. Latest-result copy no longer calls old data this
week or treats a reread date as a fresh measurement.

Verification: 27 Node tests, typecheck, and the final 77-page production build
passed. The added offline archive case covers an absent brand, a method change,
and a later reread of the same measurement. Browser rendering remains unverified.
No CSS changes or new design suppressions were introduced.

Scheduled-run observation: on September 14 at 13:02 local, Task Scheduler showed
the existing weekly task Running. Its log began at 13:00:02 and passed Git guards,
then started coding with all five engines and the hosted batch extractor. At
13:07 the log reached 60/375 calls with zero failures. This confirms startup and
partial progress only; publication, remaining categories, and push are pending.
Main remains at af06305 with no tracked changes; the budget remains $150.

## Cycle 11: resolve recovery inputs before extraction costs accrue

Recovery now refuses a source identity present in both published and held
storage. Neither record is selected or changed. Grounding requirements and the
brand limit are resolved before extraction; edits to legacy fallback engine
configuration during a batch cannot change the publication decision afterward.
Recorded engine declarations retain priority. A legacy fallback remains current
policy, not proof of the original engine configuration.

The public methodology also now matches the hosted-only extraction restriction.
Removed unsupported claims that standings and ChatGPT figures were immune to
extractor bias. The method distinguishes model agreement from accuracy and states
that human adjudication of the saved-answer review packet is pending.

Verification: the new grounding mutation and ambiguous-source checks failed
before the fix. All 156 Python tests passed afterward. The 77-page build passed;
generated methodology HTML contains the corrected uncertainty and pending-review
statements and omits the obsolete local-harness availability claim. No provider
calls, source-record edits, or changes to the running main checkout were made.
At 13:11 local the scheduled log reported 100/375 coding calls, zero failures;
publication and the remaining categories are still pending.

## Cycle 12: retain operator access during archive corruption

The admin page now catches published-history failures per category. The affected
category's history count, latest reading, and brand count say unavailable;
healthy categories and operator controls remain reachable in the server output.
Public history readers still throw on invalid records. Archive scans also report
failed directory reads and date-shaped non-directories, retain readable siblings,
and identify the held/published bucket in combined errors. A missing archive root
remains an empty archive; permission errors do not become an empty success.

Verification: 29 Node tests passed, including an in-process render of the actual
admin page with a corrupt published record. That check uses real archive readers
and React server rendering, with child widgets stubbed; it is not a browser or
widget acceptance claim. Directory fixtures cover stat/list failures, non-directory
entries, a readable sibling, denied root access, and an absent root. The final
77-page build passed, and the two affected checks passed again after adding
explicit path and strict-public-reader assertions. Python is unchanged from its
156-test pass. At 13:17 local the scheduled task remained Running and reported
150/375 coding calls with zero failures. Main remains clean and frozen.

## Cycle 13: derive current quarantine from immutable readings

The writer creates quarantine sidecars only for nonempty results. Reading the
latest sidecar therefore left stale names on the admin page after a clean run.
The admin now reads the latest archived record per category, including an
explicit empty quarantine, and uses that record's answered-call denominator.
Refusals no longer dilute the displayed materiality threshold. Missing or
malformed quarantine, a missing denominator, duplicate held/published identity,
and archive read failures make the review explicitly incomplete. Readable
categories remain visible; an incomplete result never claims nothing needs review.
Frequency is described as a review priority rather than proof of product identity.

Verification: all 30 Node tests and the 77-page build passed. Fixtures cover a
clean reading after an older hold, a material name with refused answers, malformed
quarantine, ambiguous identity, and absent denominator. The actual admin server
component check also verifies the incomplete-review message. Removed the obsolete
sidecar denominator reader; no archives or sidecars were changed. The Python
source remains at its 156-test pass. At 13:21 local the scheduled coding log reached
180/375 calls, zero failures; publication and later categories remain pending.

## Cycle 14: bind question labels to the reading they describe

Head-to-head and consensus views previously loaded today's bank even when their
reading included frozen question wording. The shared question loader now accepts
the reading and prefers its snapshot. Homepage and dated/current chart boards
use the same loader. Empty or partial snapshots never acquire additional wording
from today's bank. Pages that use the legacy fallback disclose that historical
wording was not recorded. Chart and consensus date copy identifies measurement
dates rather than presenting a reread as a fresh measurement.

Verification: 31 Node tests and the 77-page build passed. The loader test covers
changed wording, empty snapshots, legacy fallback, and a snapshot whose live bank
is absent. Generated homepage, current chart, and dated-chart HTML contain the
legacy caveat. Browser acceptance remains pending. No dependencies, CSS rules,
or archive records changed. At 13:24 local the scheduled coding log reached
210/375 calls with zero failures; main remains frozen for the live task.

## Cycle 15: explain and report checkpoint recovery accurately

Restart progress now includes saved answers in its completion total and explicitly
reports how many calls were reused and remain. Previously a partial restart could
finish all remaining calls without ever printing the full population. The method
page now describes per-response checkpoints, crash-window limits, configuration
refusal before calls, and actual snapshot/version enforcement. It distinguishes
intermediate writes from final publication and usage estimates from subscription
costs. Removed obsolete claims that interrupted runs recover nothing or missing
credentials are deliberately queried.

Verification: all 156 Python tests and the 77-page build passed. The existing
restart test now covers full reuse plus a partial checkpoint set, confirms only
the missing call repeats, and checks the final 3/3 progress message. Generated
methodology HTML contains the corrected recovery, credential, cost, and comparison
statements. Node source is unchanged from its 31-test pass. At 13:27 local the
scheduled coding log reached 250/375 calls with zero failures; its main checkout
remains untouched and publication is pending.

## Cycle 16: reject noncanonical measurement dates before paid work

The main measurement entry accepted compact and ISO week dates through Python's
date parser, although the final archive writer requires YYYY-MM-DD. It now checks
the canonical representation before provider resolution, preventing a late refusal
after measurement and extraction costs. Existing canonical dates, including
dates used for checkpoint recovery, retain their behavior.

Verification: all 21 recovery tests passed. The added check submits compact,
ISO-week, and invalid calendar dates through the public run_category entry;
provider resolution is trapped and no JSON checkpoints or data directory appear.
Only the guard changed in production code; the previous full Python pass was 156
tests before adding this case. Node and build inputs are unchanged.

## Cycle 17: make web CI's Python dependency explicit

The web job runs the cross-language publication-limit check, which imports the
normalizer and PyYAML. Only the separate Python job installed those requirements.
The web job now sets up Python 3.12 and installs the same pinned requirements
before npm test; it no longer relies on incidental hosted-runner packages. The
test's obsolete standard-library-only comment was corrected.

Verification: an isolated Python import with site packages disabled failed at
the expected missing yaml dependency. Parsed workflow inspection confirms Python
setup and pinned installation precede npm test in the web job. Existing agreement
tests already cover the import; no duplicate configuration test suite was added.
This is a local workflow correction, not a hosted CI pass. The integration gate
above records remaining live, browser, human-review, and external evidence work.

## Cycle 18: reserve the cost recovery will actually incur

Recovery used the fresh-measurement estimate even though it never re-queries
engines. The shared estimator now has an extraction-only mode based on recorded
extraction line items and billed extraction counts. Recovery requests that mode
for eligible saved answers; genuine engine failures require no extractor call.
All historical spend remains in the monthly total, and the existing conservative
fallback applies when no extraction usage can price the operation. The ceiling
is unchanged. This is an estimate, not a guarantee of provider balance or usage.

Verification: all 158 Python tests passed. A case with costly engine calls proves
fresh measurement refuses while an affordable extraction-only recovery fits the
same ceiling without erasing historical spend. Missing extraction usage retains
the unconfident fallback. The actual recovery-entry refusal check also verifies
the mode and eligible-call count; both focused budget checks passed after that
assertion was added. No paid recovery or live-checkout edits were performed.
At 13:41 local the scheduled task remained Running, with all 375 coding answers
submitted and pending in the extraction batch. Publication remains unproven.
