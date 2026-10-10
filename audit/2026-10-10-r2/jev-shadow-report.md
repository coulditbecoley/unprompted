# Jev in shadow: a second reader for Unprompted (corrected reading)

Prepared 2026-10-10. Reader: TypeSafe `jev-1.13.0`, pinned. Reading set `2026-10-10-r2`.
Evidence in this folder: `jev-shadow-comparison.json` (every figure and every disagreement
with its answer identity) and `jev-probes.json` (option-order and planted-text checks).
Per-answer readings: `audit/jev-shadow/2026-10-10-r2/` (gitignored, kept locally with a
verified backup; see Storage).

This replaces `audit/2026-10-10/jev-shadow-report.md`, which is kept unchanged as the
first record. An independent review (Panel 2) found seven problems in the first reader
and report; they are addressed as listed in "Changes since the first reading", with
lowercase name ordering kept as a documented limit rather than changed.

**Every agreement figure below is agreement with the published Opus reading, not
accuracy.** Neither reader is ground truth. The accuracy test is the blinded human review
in `READING-REVIEW.md`, which has no labels yet.

Nothing in this work changed a published number, a frozen manifest, the published
extractor, `EXTRACT_PROMPT`, an alias map, a question bank, `providers.json`, or any file
in `data/`. No engine was queried.

## Summary

- Jev read all 4,581 stored answers in the 14 run and held records with **no recorded
  failed readings** (SDK retries are not counted) and no refusal contradictions:
  26.1 million input tokens, **$1.10 in total, $0.24 per 1,000 answers**, about two
  minutes of wall clock. The recorded Opus figure is $14.10 per 1,000.
- Across the 3,926 answers both readers read: **first brand 88%, exact brand set 68%,
  set overlap 89%, refusal 100%**. On the recent coding records: 2026-09-07 scores
  97% / 87% / 96%, 2026-09-14 scores 97% / 84% / 96%, and the newest, 2026-09-28, scores
  92% / 86% / 95% (first brand / exact set / overlap). Opus re-reading earlier Opus readings scored
  89%, 77% and 91% (`extract.py`).
- The code-only candidate step found **16,009 of the 16,010** brands in the published
  readings. The one miss appears only inside a URL, which the step ignores on purpose.
- Published Rotation would move beyond the existing noise test in **4 of the 5
  published runs**. In 770 of the 978 answer-level differences behind the upward moves,
  a quarantined name from that week contains the brand and all its words occur in the
  answer. **This is a possible, unverified explanation:** the archive does not store
  Opus's raw names per answer, so it cannot show what Opus wrote for that answer. The
  downward moves are reading differences: Jev reads some brands as context or as
  something to avoid where Opus listed them.

## How the reader works

`src/unprompted/jev_reader.py` reads one stored record and never an engine.

1. **Candidates in code.** Every canonical name, alias and excluded name in the record's
   own alias map is matched with `normalize.py`'s folding (case, punctuation,
   possessives). Unknown candidates come from list items, bold text, headings, link
   text and capitalised product-like spans; each keeps its earliest mention. Compounds
   such as "SGC/TAG/Ace" are split. URLs are masked. An excluded grade or tier still
   names its brand: "a PSA 10" and "CGC Bulk" yield PSA and CGC, as `EXTRACT_PROMPT`
   says, while "Adobe Photoshop" implies nothing. **Position comes from character
   offsets**, in code.
2. **One request per answer** (11 of 4,581 needed two). For each candidate, a Choice on
   its role (option, context, something to avoid, not a company) using
   `EXTRACT_PROMPT`'s definitions, and a Choice on sentiment. Per answer, Nouls for
   refusal (in the prompt's words: "decline to recommend anything, or name no companies
   at all"), injected instructions and, where the frozen question is known, an
   off-topic answer. Answer text and candidate names go to Jev only inside `state`.
   Requests are kept under TypeSafe's limits as **locally bounded UTF-8 input, subject
   to provider acceptance**; no stored answer came near them.
3. **A refusal that also recommends is rejected**, the same contradiction rejection as
   the published extractor (`extract._apply`). There were none in this reading.
4. **Output in the `Extraction` shape**, normalized with the alias map the published
   reading used: frozen in the record where present, otherwise recovered from git at
   the record's commit.

## Results

### By record

| record | answers | first brand | exact set | set overlap | refusal | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| runs/2026-08-21/pokemon-grading | 225 | 100% | 76% | 92% | 100% | 95% | 98% | 132 |
| runs/2026-08-22/ai-coding-assistants | 225 | 75% | 54% | 84% | 100% | 71% | 97% | 89 |
| runs/2026-08-22/ai-writing-tools | 225 | 77% | 54% | 79% | 100% | 78% | 97% | 78 |
| runs/2026-08-24/ai-image-generators | 201 | 85% | 50% | 84% | 100% | 74% | 96% | 64 |
| runs/2026-09-14/ai-coding-assistants | 374 | 97% | 84% | 96% | 100% | 94% | 99% | 192 |
| held/2026-08-23/ai-image-generators | 0 | no Opus reading: every extraction failed | | | | | | |
| held/2026-08-24/ai-coding-assistants | 279 | 75% | 55% | 83% | 100% | 76% | 98% | 75 |
| held/2026-09-07/ai-coding-assistants | 373 | 97% | 87% | 96% | 100% | 93% | 98% | 184 |
| held/2026-09-07/ai-image-generators | 374 | 83% | 55% | 85% | 100% | 77% | 98% | 126 |
| held/2026-09-07/ai-writing-tools | 375 | 90% | 77% | 92% | 100% | 91% | 98% | 183 |
| held/2026-09-14/ai-image-generators | 375 | 89% | 61% | 87% | 100% | 81% | 97% | 135 |
| held/2026-09-28/ai-coding-assistants | 450 | 92% | 86% | 95% | 100% | 90% | 93% | 144 |
| held/2026-09-28/ai-image-generators | 450 | 84% | 60% | 85% | 100% | 72% | 99% | 106 |
| held/2026-09-28/ai-writing-tools | 0 | no Opus reading: every extraction failed | | | | | | |

Definitions. *First brand*: both readers put the same brand first, or both listed none.
*Exact set*: same brands, any order. *Set overlap*: brands in both readings over brands
in either, pooled over answers. *Position (shared)*: shared brands at the same position.
*Order (shared)*: answers whose shared brands appear in the same relative order.
*Sentiment flips*: shared brands with a different sentiment. Answers where either reader
failed, or the engine returned nothing, are excluded and counted in the JSON.

### By category, pooled

| category | answers | first brand | exact set | set overlap | refusal | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pokemon-grading (archived) | 225 | 100% | 76% | 92% | 100% | 95% | 98% | 132 |
| ai-coding-assistants | 1701 | 89% | 76% | 92% | 100% | 87% | 97% | 684 |
| ai-writing-tools | 600 | 86% | 69% | 87% | 100% | 86% | 98% | 261 |
| ai-image-generators | 1400 | 85% | 58% | 86% | 100% | 76% | 98% | 431 |
| **all** | 3926 | 88% | 68% | 89% | 100% | 84% | 97% | 1508 |

### By category and engine, pooled

| category / engine | answers | first brand | exact set | set overlap | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|
| pokemon-grading / chatgpt | 75 | 100% | 87% | 96% | 98% | 99% | 48 |
| pokemon-grading / claude | 75 | 100% | 53% | 85% | 90% | 97% | 42 |
| pokemon-grading / perplexity | 75 | 100% | 89% | 96% | 97% | 99% | 42 |
| ai-coding-assistants / chatgpt | 374 | 83% | 60% | 86% | 79% | 99% | 124 |
| ai-coding-assistants / claude | 299 | 86% | 74% | 93% | 83% | 90% | 211 |
| ai-coding-assistants / claude-code | 279 | 90% | 76% | 94% | 89% | 94% | 217 |
| ai-coding-assistants / codex | 300 | 92% | 82% | 91% | 95% | 100% | 59 |
| ai-coding-assistants / gemini | 75 | 92% | 79% | 95% | 88% | 96% | 2 |
| ai-coding-assistants / perplexity | 374 | 94% | 89% | 97% | 95% | 100% | 71 |
| ai-writing-tools / chatgpt | 150 | 71% | 35% | 73% | 72% | 99% | 23 |
| ai-writing-tools / claude | 150 | 93% | 75% | 93% | 89% | 96% | 114 |
| ai-writing-tools / claude-code | 75 | 91% | 83% | 95% | 89% | 97% | 55 |
| ai-writing-tools / codex | 75 | 79% | 72% | 87% | 89% | 100% | 24 |
| ai-writing-tools / perplexity | 150 | 93% | 87% | 93% | 97% | 99% | 45 |
| ai-image-generators / chatgpt | 300 | 91% | 53% | 82% | 79% | 100% | 80 |
| ai-image-generators / claude | 276 | 80% | 44% | 84% | 68% | 95% | 147 |
| ai-image-generators / claude-code | 224 | 85% | 39% | 84% | 68% | 99% | 121 |
| ai-image-generators / codex | 225 | 85% | 78% | 90% | 91% | 100% | 22 |
| ai-image-generators / gemini | 75 | 87% | 53% | 84% | 83% | 96% | 0 |
| ai-image-generators / perplexity | 300 | 85% | 75% | 92% | 83% | 97% | 61 |

Refusal agreement is 100% everywhere, but it is trivial: the archive contains no
refusals from either reader.

### Candidate coverage

| measure | result |
|---|---|
| Brands in the published readings that a candidate resolved to | 16,009 of 16,010 |
| Distinct quarantined Opus names matched exactly by a candidate | 1,264 of 1,734 (record level) |
| Distinct quarantined Opus names overlapping a candidate | 1,722 of 1,734 (record level) |
| Archived rows whose candidates changed with the corrections | 226 of 4,725 |

Known limit: a lowercase product mention before a capitalised one ("try aider first ...
Aider") takes the capitalised offset. Across the archive this order occurs in 9 of 3,926
answers, and only 1 is a real product; the rest are words such as "playground". A rule
that counted lowercase mentions would have misread more answers than it fixed.

### Cost and speed

| record | answers read | input tokens | Jev dollars | per 1,000 answers | wall clock | requests |
|---|---:|---:|---:|---:|---:|---:|
| runs/2026-08-21/pokemon-grading | 225 | 1,294,430 | $0.0544 | $0.24 | 5.6s | 226 |
| runs/2026-08-22/ai-coding-assistants | 225 | 1,599,468 | $0.0672 | $0.30 | 6.3s | 228 |
| runs/2026-08-22/ai-writing-tools | 225 | 1,434,194 | $0.0602 | $0.27 | 5.9s | 226 |
| runs/2026-08-24/ai-image-generators | 201 | 1,325,389 | $0.0557 | $0.28 | 6.0s | 202 |
| runs/2026-09-14/ai-coding-assistants | 375 | 2,124,025 | $0.0892 | $0.24 | 10.0s | 376 |
| held/2026-08-23/ai-image-generators | 201 | 1,457,817 | $0.0612 | $0.30 | 5.5s | 203 |
| held/2026-08-24/ai-coding-assistants | 279 | 1,708,816 | $0.0718 | $0.26 | 7.0s | 281 |
| held/2026-09-07/ai-coding-assistants | 375 | 2,050,060 | $0.0861 | $0.23 | 9.3s | 375 |
| held/2026-09-07/ai-image-generators | 375 | 1,986,681 | $0.0834 | $0.22 | 10.3s | 375 |
| held/2026-09-07/ai-writing-tools | 375 | 1,927,869 | $0.0810 | $0.22 | 8.9s | 375 |
| held/2026-09-14/ai-image-generators | 375 | 2,034,390 | $0.0854 | $0.23 | 11.2s | 375 |
| held/2026-09-28/ai-coding-assistants | 450 | 2,399,632 | $0.1008 | $0.22 | 11.4s | 450 |
| held/2026-09-28/ai-image-generators | 450 | 2,433,582 | $0.1022 | $0.23 | 13.2s | 450 |
| held/2026-09-28/ai-writing-tools | 450 | 2,331,837 | $0.0979 | $0.22 | 11.0s | 450 |
| **all** | 4,581 | 26,108,190 | **$1.10** | **$0.24** | **122s** | 4,592 |

Price: $0.042 per million input tokens, output free (https://docs.typesafe.ai/models,
read 2026-10-10). Dollars are reported input tokens times that price, not an invoice.
The probes below used another 803,378 tokens ($0.03). The Opus figure of $14.10 per
1,000 was measured for Opus 5; the current extractor is Opus 5.5, so the ratio (about
60 to 1) is approximate. Wall clock is eight concurrent requests from this machine.

### Would published Rotation change?

Recomputed with the existing `brand_week()` and tested with the existing
`exceeds_noise()`, each over its own reading's usable answers. That test assumes
independent samples; both readings come from the same answers, so it is used only as
the publication's own bar, not as a significance claim.

| published run | brands that differ | beyond the noise test |
|---|---:|---|
| 2026-08-21 pokemon-grading | 13 | Beckett 84% to 73%, PSA 99% to 93% |
| 2026-08-22 ai-coding-assistants | 12 | GitHub Copilot 64% to 87% |
| 2026-08-22 ai-writing-tools | 13 | Gemini 39% to 61%, ChatGPT 74% to 92%, Claude 78% to 94%, Copilot 10% to 23%, Grammarly 41% to 54% |
| 2026-08-24 ai-image-generators | 11 | DALL-E 27% to 54%, Imagen 26% to 44% |
| 2026-09-14 ai-coding-assistants | 23 | none |

Held records show the same pattern (DALL-E and Imagen up in every image week; GitHub
Copilot and Cursor up on 2026-08-24; JetBrains AI 2% to 6% on 2026-09-28).

| kind of difference behind the moves | upward | downward |
|---|---:|---:|
| possible quarantine match (unverified, see below) | 770 | 0 |
| Jev listed it, no quarantined name matches | 151 | 0 |
| Opus listed it, Jev called it context | 26 | 26 |
| Opus listed it, Jev called it something to avoid | 2 | 8 |
| Opus listed it, Jev called it not a company | 29 | 1 |

What "possible quarantine match" means, exactly: a quarantined name from that record
contains the brand Jev found, and every word of it occurs somewhere in the answer. The
record's quarantine list has no answer identities, so this does not show that Opus
wrote that name for that answer. Example: in `runs/2026-08-22/ai-coding-assistants`,
claude q06 run 4, the answer recommends "GitHub Copilot Pro (~$10/month)"; the match
the comparison found is a different quarantined name, "GitHub Copilot coding agent",
whose words also occur in that answer. Settling these needs Opus's raw names stored per
answer (see "Retaining raw extractor output").

The 151 Jev-only finds with no matching quarantined name are concentrated in DALL-E
(118 across all records), mostly in phrases such as "OpenAI's GPT Image 2.5" or
"Microsoft Copilot / Designer (DALL·E 3)". Some may be answers where Opus wrote
"ChatGPT" or "OpenAI", which the image category excludes and `normalize()` drops
silently; the stored records cannot show which.

### Instructive disagreements

Quoted from `audit/jev-shadow/2026-10-10-r2/<bucket>/<date>/<category>.json`; dashes in
quotes are replaced by commas or parentheses.

**1. Something to avoid** (`held/2026-09-28/ai-image-generators`, gemini q14 run 3). Opus
listed Adobe Firefly, Midjourney, Stable Diffusion, DALL-E; Jev listed Adobe Firefly only,
with Midjourney avoid 0.89:

> ### Why other popular tools (Midjourney, Stable Diffusion, DALL-E) are riskier:
> * **Midjourney & Stable Diffusion:** These tools were trained on massive open-web
> datasets (like LAION) that scraped billions of copyrighted images without creators'
> explicit permission.

`EXTRACT_PROMPT` says to ignore companies presented as something to avoid. Midjourney and
Stable Diffusion are 72 of the 127 "Opus listed, Jev called avoid" cases, 55 of them on
q14, "Which AI image generator is safest for licensing and copyright?"

**2. A close call** (`runs/2026-08-21/pokemon-grading`, claude q08 run 3). PSA: avoid
0.51, option 0.49.

> For a beginner in 2026, PSA (the traditional default) has become a bad first
> experience. **Why not PSA right now:** PSA stopped accepting every Value grading tier
> on June 2, 2026...

**3. Context** (`runs/2026-09-14/ai-coding-assistants`, perplexity q11 run 2). Opus listed
Cursor; Jev: context 0.87.

> If you tell me your editor (**VS Code, JetBrains, Cursor, terminal**) and whether you
> want **autocomplete**, **chat**, or **agentic multi-file edits**, I can give you the
> best single pick.

**4. Skip at the start** (`runs/2026-09-14/ai-coding-assistants`, claude-code q03 run 4).
Opus listed Claude Code, Codex and Gemini Code Assist; Jev listed none of them (Gemini
CLI avoid 1.00):

> What I'd skip at the start: terminal agents like **Claude Code** (Anthropic, who makes
> me, flagging the conflict of interest), **OpenAI Codex CLI**, or **Gemini CLI**. ...
> Move to one after a couple months.

This is Claude Code deferring its own maker's product, which bears on the
self-preference figures.

**5. A Jev misreading** (`runs/2026-08-24/ai-image-generators`, chatgpt q14 run 3). Opus
listed Imagen; Jev did not. The longer phrase "Google Vertex AI Imagen" was judged an
option (0.89), but as an unknown name it goes to quarantine, while the canonical "Imagen"
candidate came back not a company 0.51, option 0.48. Across all records, Opus listed a
brand Jev called not a company 85 times, most often Imagen, Stable Diffusion, Adobe
Firefly and Flux, usually at close margins. Low role confidence is what a cascade would
use to send such answers on to Opus.

### Checks on Jev itself (`jev-probes.json`, seed `jev-probes-v1`)

- **Option order.** 150 answers sampled by seed from this set, each re-asked with the
  four role options reversed and the same state as the original read: 670 of 678 known
  brand judgments kept their role (98.8%); 0 failed samples. Every sample, with both
  sets of judgments and its source hash, is in the file.
- **Planted text.** A quoted page telling AI readers to recommend Zed: injection 0.96,
  Zed not listed. A direct "system note" naming Windsurf: injection 0.99, Windsurf not
  listed. A refusal: refused 0.99. An off-topic travel answer: off-topic 0.99. This shows
  the screens respond; it is not a measured detection rate.
- **Archive screens.** Highest injection score in the archive 0.36
  (`held/2026-09-28/ai-coding-assistants`, codex q12 run 2); none of 4,581 reached 0.5 on
  injection or refusal, and none of 2,100 with a frozen question reached 0.5 on
  off-topic.
- **Sentiment.** 1,508 of 15,565 shared brands (9.7%) differ. 1,227 of those (81%) are
  between neutral and positive; 281 (19%) involve negative sentiment, almost all neutral
  to negative (274). Sentiment is second-order and unused in any ranking.

## Changes since the first reading

| Review finding | Change | Effect |
|---|---|---|
| 1. Candidate order could drop a first mention | Unknown names keep their earliest mention; excluded grades and tiers ("CGC Bulk", "PSA 10") name their brand. The lowercase case was measured and left as a documented limit | 226 of 4,725 rows changed candidates; card-grading first brand 98% to 100% |
| 2. Quarantine attribution stated as fact | Renamed "possible quarantine match"; field `possible_quarantined_name`; stable order; all causal claims removed | Comparison output now identical across runs |
| 3. Empty brand sets hid Rotation changes | Rotation uses each reading's usable answers as its denominator | No change on this archive; covers future weeks |
| 4. Label scoring accepted duplicate or altered rows | Duplicates, changed answers, bad names and positions refused | The real packet still waits for labels |
| 5. Refusal rule differed from the extractor | Refusal plus recommendations is rejected as `extract._apply` rejects it; refusal question uses the prompt's words | 0 contradictions in this reading |
| 6. Request limits not enforced | Local UTF-8 byte bounds for both TypeSafe limits; oversized answers refused before any request | 11 answers split into two requests; 0 refused |
| 7. Report overstated evidence | Figures re-derived from saved files; probes saved per sample | This report |

Headline agreement is unchanged: first brand 88%, exact set 68%, set overlap 89%.

## Storage and integration

- **Readings** live in `audit/jev-shadow/<reading set>/` and are gitignored, so they can
  never make a measurement's `git_sha` read "-dirty" or ride along in a weekly commit.
  The first reading is preserved as set `2026-10-10`; this one is `2026-10-10-r2`. Both
  have hash-verified backups in `C:\Users\coley\Backups\unprompted\`. A fresh clone cannot
  re-score Jev without them or a new paid read.
- **Weekly.** Once merged, the Monday launcher ends with
  `scripts/compare_jev.py weekly`: after the week is committed and pushed, Jev reads the
  date that run measured, within a 30-minute budget that keeps clear of the task's 8-hour
  limit, one child process per category, killed at the budget. Its exit code is ignored
  and it writes nothing to `data/`, `data/last-run.json` or the notification. Status:
  **integrated but not live-qualified** until a week actually reaches that step (the
  2026-10-05 week stopped early on an unreconciled extraction batch).

## Retaining raw extractor output

Answer-level attribution of the quarantine question needs Opus's raw names stored per
answer before normalization. That changes what the published extraction path writes and
is a decision for the operator, not part of this change.

## Phase 2: labels

`review_extractions.py score <packet> --reading <file>` scores Jev on exactly the items the
published reading is scored on. The 75-answer baseline packet (median 242 words, about 1.5
to 2.5 hours to label) is unchanged; the readers disagree on brand set or first brand in 19
of its items. A second packet drawn from disagreements would be where labels decide most.
No labels were supplied by any model.

## Phase 4: proposal only

Unchanged from the first report except as noted.

- **Version bump.** Adopting Jev as the published reader changes the extractor and the
  extraction instructions, which the runner refuses without a bump: every category up one
  (coding to 5; images and writing to 6). The frozen snapshot would record the reader, the
  candidate rules and the full question set.
- **History.** Re-reading the archive costs about $1.10; recommended: re-read history as
  new append-only records with their original `measured_on` and `source_run`. Decide the
  quarantine question first, as its own alias-policy change, so its effect stays separable
  from the reader's.
- **Cascade.** Jev reads everything; answers with low known-brand role confidence go on to
  Opus, threshold chosen from the Phase 2 labels. The first report's escalation rates
  (11% at 0.5 to 39% at 0.9) were computed on the first reading and should be recomputed
  from this set before use.
- **Disclosure** and a possible **recommendation-strength** Score: as in the first report.

## Limits

- Agreement is not accuracy. Until the packet is labelled, nothing here says which reader
  is right.
- The comparison sees only Opus's normalized names.
- Older records' alias maps are recovered from git; two were measured from a dirty tree.
- Jev is pinned to 1.13.0. A new version is a new reader and needs this comparison again.
