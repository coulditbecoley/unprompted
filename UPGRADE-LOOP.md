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
