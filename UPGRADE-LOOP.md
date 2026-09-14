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
