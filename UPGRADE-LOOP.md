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
