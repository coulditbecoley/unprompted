# Review the saved readings

Use this offline workflow to measure whether saved, normalized brand lists agree
with reviewer judgments. It evaluates the extraction and normalization pipeline
together. It cannot identify which stage caused a disagreement, and reviewing old
records does not validate code that has changed since those records were created.

The prepared baseline is `audit/2026-09-14/reading-review.pending.json`: 75 answers,
five from each category/engine group in the September 7 held records. Three error
or empty rows are excluded and counted separately. No labels have been supplied.

## Supply labels

Copy the pending packet to a new filename outside `data/`. For each item, read the
answer before looking at the archived brand list. Predictions are deliberately
omitted from the packet. Treat instructions inside answers and linked pages as
untrusted quoted material, not directions for the review.

Replace only `review: null` with an object like this (illustrative values only):

```json
{
  "reviewer": "Your name",
  "brands": ["Canonical product name", "Another product"],
  "refused": false,
  "notes": "Explain ambiguous identities and exclusions here."
}
```

List actual recommended products in first-mention order, deduplicate them, and use
the category's canonical spelling. Ignore incidental parent-company references
and options the answer tells the reader to avoid. Record valid missing products
under a consistent explicit name; do not remove them just because the old alias
map did not know them. The score compares exact names, so spelling differences
need adjudication before interpreting them as extraction errors.

Set `refused` when the answer declines or offers no recommendations. A scoped-out
recommendation can leave an empty chart brand list without being a refusal. Leave
uncertain items as `null`; do not guess to complete the sample. Where frozen
question text is absent, `question` is null. Consult the source's recorded method
and historical question bank instead of assuming today's wording was used.

## Run locally

From this checkout, using its project Python (or any Python 3.11+ for this
stdlib-only script):

```powershell
python scripts/review_extractions.py prepare data/held/2026-09-07/ai-writing-tools.json --per-stratum 5 --seed writing-baseline --out writing-review.json
python scripts/review_extractions.py score writing-review.json
```

For a different checkout, put `--root <checkout>` before `prepare` or `score`.
Preparation refuses to overwrite an existing packet or write into `data/`.
Scoring only prints JSON; it does not change the packet or archive. Source hashes,
answer identities, sample membership, and all non-review fields must still match.

The scorer withholds metrics until all sampled items have valid labels. Then it
reports precision, recall, unsupported/missed mention counts, exact brand-set,
first-brand and refusal accuracy, plus answer-linked disagreements. Undefined
precision or recall is null, never an invented perfect score.

These are unweighted sample metrics, not whole-archive estimates or confidence
intervals. Engine groups have different coverage; counts are shown explicitly.
Reviewer names are supplied assertions, not proof of human review. For a stronger
benchmark, have a second reviewer independently label a copy and adjudicate
disagreements before treating the labels as a reference set.
