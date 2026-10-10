# Jev in shadow: a second reader for Unprompted

Prepared 2026-10-10. Reader: TypeSafe `jev-1.13.0`, pinned. Code: commit `9cda960`
on branch `jev-shadow-reader`. Raw results: `audit/2026-10-10/jev-shadow-comparison.json`.
Readings: `audit/jev-shadow/`.

**Every agreement figure below is agreement with the published Opus reading, not
accuracy.** Neither reader is ground truth. The accuracy test is the blinded human
review in `READING-REVIEW.md`, which has no labels yet.

Nothing in this work changed a published number, a frozen manifest, the published
extractor, `EXTRACT_PROMPT`, an alias map, a question bank, `providers.json`, or any
file in `data/`. No engine was queried. The weekly run does not call the new code.

## Summary

- Jev read all 4,581 stored answers in the 14 run and held records with **no failed
  requests**: 26.1 million input tokens, **$1.10 in total, $0.24 per 1,000 answers**,
  in about two minutes of wall clock. The recorded Opus figure is $14.10 per 1,000.
- Across the 3,926 answers where both readers produced a reading: **first brand 88%,
  exact brand set 68%, set overlap 89%, refusal 100%**. On the newest coding records
  agreement reaches first brand 97%, exact set 86%, set overlap 96%. For scale, Opus
  re-reading earlier Opus readings scored 89%, 77% and 91% (the figures in `extract.py`).
- The code-only candidate step found **16,009 of the 16,010** brands in the published
  readings (99.99%). The one miss is a name that appears only inside a URL, which the
  step ignores on purpose.
- Published Rotation would move beyond the existing noise test in **4 of the 5
  published runs**. Almost all of the upward moves are **not Jev judging differently**:
  in 771 of the 980 answer-level differences behind them, Opus named the brand inside
  a longer phrase ("GitHub Copilot Pro (~$10/month)", "OpenAI's GPT Image in ChatGPT")
  that the alias map could not resolve, so it went to quarantine and never reached
  the chart. The downward moves are real judgment differences: Jev reads some brands
  as context or as something to avoid where Opus listed them.
- That second finding matters for the published chart regardless of Jev: DALL-E,
  Imagen, GitHub Copilot, ChatGPT, Claude and Gemini are named more often than their
  published Rotation says, by the published reader's own words, because of where
  quarantine draws the line. That is an alias policy question for a human, and it is
  flagged here, not changed.

## What was built

- `src/unprompted/jev_reader.py`. Reads one stored record, never an engine.
  1. **Candidates in code.** Every canonical name, alias and excluded name in the
     record's own alias map is matched with the same folding `normalize.py` uses
     (case, punctuation, possessives). Unknown candidates come from list items, bold
     text, headings, link text and capitalised product-like spans. Compounds such as
     "SGC/TAG/Ace" and "TAG and AGS" are split. URLs are masked. An excluded grade
     still names its brand, so "a PSA 10" yields PSA, as `EXTRACT_PROMPT` says.
     **Position comes from character offsets**, in code.
  2. **One request per answer, all candidates at once.** For each candidate, a Choice
     on its role (option, context or aside, something to avoid, not a company) using
     `EXTRACT_PROMPT`'s own definitions and exclusions, and a Choice on sentiment. Per
     answer, Nouls for refusal, injected instructions and (when the frozen question is
     known) an off-topic answer. A request is split only if it would exceed Jev's
     64k-token limit; none did.
  3. **Output in the `Extraction` shape**, normalized with the record's own alias map,
     plus every candidate's probabilities and confidence, the model returned, and
     `reader: "jev-1.13.0"`.
- `scripts/compare_jev.py`: `coverage` (no calls), `compare` (reads only records that
  have no shadow reading yet, with `--read`), and `alarm` (one week).
- `scripts/review_extractions.py score --reading <shadow file>`: scores a shadow
  reading against the same labelled packet as the published reading.
- 11 offline tests with a fake client; the full suite passes (197 tests).

### Why `audit/jev-shadow/` and not `data/shadow/`

The weekly script refuses to start if anything under `data/` is uncommitted, and it
commits all of `data/` as the week's measurement. Shadow files under `data/` could
therefore stop a Monday run, or be swept into a bot commit that claims to be a
measurement. The site and checks read only `data/runs` and `data/held`. `audit/` is
already where this repository keeps evidence, nothing on the publication path reads
it, and the weekly script neither checks nor stages it. Writes there are
create-if-absent through the same `write_json` that guards `data/runs/`, and refuse
any path outside `audit/jev-shadow/`.

### Three design choices the data forced

- **Candidates are referred to by key, not list position.** In the pilot, an
  instruction pointing at `candidates[17]` of a 30-item list was answered about a
  neighbouring item ("Recraft" judged not a company while "Pro" and "50k" were judged
  options). Switching to named keys (`candidates.c017`) removed it. This matches the
  counting and indirection limits in TypeSafe's jaggedness notes for 1.13.
- **Each role option says "company or brand".** Jev reads literally; without it, use
  cases such as "Social posts" were judged options.
- **Older records are normalized with the alias map they were measured with.** Records
  from before 2026-09-14 did not freeze their map. The reader recovers it from the
  recorded commit, or for the earliest records from the commit that added the record.
  Using today's map would have credited Jev with every alias added since.

## Phase 1 results

### By record

| record | answers | first brand | exact set | set overlap | refusal | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| runs/2026-08-21/pokemon-grading | 225 | 98% | 77% | 92% | 100% | 94% | 96% | 126 |
| runs/2026-08-22/ai-coding-assistants | 225 | 75% | 54% | 84% | 100% | 71% | 97% | 84 |
| runs/2026-08-22/ai-writing-tools | 225 | 77% | 54% | 78% | 100% | 78% | 97% | 79 |
| runs/2026-08-24/ai-image-generators | 201 | 85% | 51% | 84% | 100% | 74% | 96% | 62 |
| runs/2026-09-14/ai-coding-assistants | 374 | 97% | 84% | 96% | 100% | 94% | 99% | 196 |
| held/2026-08-23/ai-image-generators | 0 | no Opus reading: every extraction failed | | | | | | |
| held/2026-08-24/ai-coding-assistants | 279 | 75% | 55% | 83% | 100% | 76% | 98% | 82 |
| held/2026-09-07/ai-coding-assistants | 373 | 97% | 86% | 96% | 100% | 93% | 98% | 176 |
| held/2026-09-07/ai-image-generators | 374 | 83% | 55% | 85% | 100% | 77% | 98% | 131 |
| held/2026-09-07/ai-writing-tools | 375 | 90% | 77% | 92% | 100% | 90% | 98% | 182 |
| held/2026-09-14/ai-image-generators | 375 | 89% | 61% | 87% | 100% | 81% | 98% | 131 |
| held/2026-09-28/ai-coding-assistants | 450 | 92% | 86% | 95% | 100% | 90% | 93% | 140 |
| held/2026-09-28/ai-image-generators | 450 | 84% | 60% | 85% | 100% | 71% | 99% | 102 |
| held/2026-09-28/ai-writing-tools | 0 | no Opus reading: every extraction failed | | | | | | |

Definitions. *First brand*: both readers put the same brand first, or both listed
none. *Exact set*: same brands, any order. *Set overlap*: brands in both readings over
brands in either, pooled over answers. *Position (shared)*: brands both readers kept
that sit at the same position. *Order (shared)*: answers where the brands both kept
appear in the same relative order. *Sentiment flips*: shared brands with a different
sentiment. Answers where either reader failed, or the engine returned nothing, are
excluded and counted in the JSON.

Two held records have no Opus reading at all, because every extraction failed
(2026-08-23 images and 2026-09-28 writing). Jev read both in full; they appear in the
cost table but cannot be compared.

### By category, pooled over comparable records

| category | answers | first brand | exact set | set overlap | refusal | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pokemon-grading (archived) | 225 | 98% | 77% | 92% | 100% | 94% | 96% | 126 |
| ai-coding-assistants | 1701 | 89% | 76% | 92% | 100% | 87% | 97% | 678 |
| ai-writing-tools | 600 | 85% | 68% | 87% | 100% | 86% | 98% | 261 |
| ai-image-generators | 1400 | 85% | 58% | 85% | 100% | 76% | 98% | 426 |
| **all** | 3926 | 88% | 68% | 89% | 100% | 84% | 97% | 1491 |

### By category and engine, pooled

| category / engine | answers | first brand | exact set | set overlap | position (shared) | order (shared) | sentiment flips |
|---|---:|---:|---:|---:|---:|---:|---:|
| pokemon-grading / chatgpt | 75 | 100% | 85% | 96% | 99% | 99% | 43 |
| pokemon-grading / claude | 75 | 96% | 56% | 85% | 87% | 92% | 42 |
| pokemon-grading / perplexity | 75 | 97% | 89% | 96% | 94% | 96% | 41 |
| ai-coding-assistants / chatgpt | 374 | 83% | 60% | 86% | 79% | 99% | 124 |
| ai-coding-assistants / claude | 299 | 86% | 73% | 93% | 83% | 90% | 208 |
| ai-coding-assistants / claude-code | 279 | 90% | 76% | 93% | 89% | 94% | 218 |
| ai-coding-assistants / codex | 300 | 92% | 83% | 91% | 95% | 100% | 62 |
| ai-coding-assistants / gemini | 75 | 92% | 79% | 95% | 88% | 96% | 1 |
| ai-coding-assistants / perplexity | 374 | 94% | 89% | 97% | 95% | 100% | 65 |
| ai-writing-tools / chatgpt | 150 | 71% | 35% | 73% | 72% | 99% | 21 |
| ai-writing-tools / claude | 150 | 93% | 75% | 93% | 89% | 96% | 113 |
| ai-writing-tools / claude-code | 75 | 88% | 80% | 95% | 86% | 97% | 57 |
| ai-writing-tools / codex | 75 | 79% | 72% | 87% | 89% | 100% | 25 |
| ai-writing-tools / perplexity | 150 | 93% | 87% | 93% | 97% | 99% | 45 |
| ai-image-generators / chatgpt | 300 | 91% | 53% | 82% | 80% | 100% | 79 |
| ai-image-generators / claude | 276 | 78% | 43% | 84% | 68% | 95% | 148 |
| ai-image-generators / claude-code | 224 | 86% | 38% | 84% | 68% | 99% | 117 |
| ai-image-generators / codex | 225 | 85% | 78% | 90% | 91% | 100% | 22 |
| ai-image-generators / gemini | 75 | 85% | 53% | 84% | 82% | 96% | 0 |
| ai-image-generators / perplexity | 300 | 85% | 76% | 92% | 83% | 97% | 60 |

Refusal agreement is 100% everywhere, but it is trivial: **the archive contains no
refusals at all**, from either reader.

### Candidate coverage

| measure | result |
|---|---|
| Brands in the published readings that a candidate resolved to | 16,009 of 16,010 (99.99%) |
| Distinct quarantined Opus names matched exactly by a candidate | 1,264 of 1,734 (72.9%) |
| Distinct quarantined Opus names overlapping a candidate | 1,722 of 1,734 (99.3%) |
| Candidates per answer | 14.7 on average |

Coverage was measured before any Jev call and drove three fixes: brands written only
in lowercase ("opencode", "aider"), possessives inside aliases ("OpenAI's image
generation"), and grades on the exclude list hiding their brand ("a PSA 10").

### Cost and speed

| record | answers read | input tokens | Jev dollars | per 1,000 answers | wall clock |
|---|---:|---:|---:|---:|---:|
| runs/2026-08-21/pokemon-grading | 225 | 1,294,390 | $0.0544 | $0.24 | 5.6s |
| runs/2026-08-22/ai-coding-assistants | 225 | 1,594,727 | $0.0670 | $0.30 | 6.2s |
| runs/2026-08-22/ai-writing-tools | 225 | 1,433,873 | $0.0602 | $0.27 | 5.4s |
| runs/2026-08-24/ai-image-generators | 201 | 1,324,946 | $0.0556 | $0.28 | 6.2s |
| runs/2026-09-14/ai-coding-assistants | 375 | 2,125,093 | $0.0893 | $0.24 | 10.1s |
| held/2026-08-23/ai-image-generators | 201 | 1,455,128 | $0.0611 | $0.30 | 5.5s |
| held/2026-08-24/ai-coding-assistants | 279 | 1,707,249 | $0.0717 | $0.26 | 7.3s |
| held/2026-09-07/ai-coding-assistants | 375 | 2,053,435 | $0.0862 | $0.23 | 10.5s |
| held/2026-09-07/ai-image-generators | 375 | 1,990,056 | $0.0836 | $0.22 | 11.0s |
| held/2026-09-07/ai-writing-tools | 375 | 1,931,246 | $0.0811 | $0.22 | 8.7s |
| held/2026-09-14/ai-image-generators | 375 | 2,037,765 | $0.0856 | $0.23 | 10.4s |
| held/2026-09-28/ai-coding-assistants | 450 | 2,403,682 | $0.1010 | $0.22 | 11.4s |
| held/2026-09-28/ai-image-generators | 450 | 2,437,632 | $0.1024 | $0.23 | 11.4s |
| held/2026-09-28/ai-writing-tools | 450 | 2,335,887 | $0.0981 | $0.22 | 10.7s |
| **all** | 4,581 | 26,125,109 | **$1.10** | **$0.24** | **120s** |

Price: $0.042 per million input tokens, output tokens free, from
https://docs.typesafe.ai/models (read 2026-10-10). Dollars here are input tokens
reported by the API times that price, not an invoice. The Opus comparison figure,
$14.10 per 1,000 answers, is the one recorded in `extract.py`; it was measured for
Opus 5, and the current extractor is Opus 5.5, so treat the ratio (roughly 60 to 1)
as approximate. Wall clock is eight concurrent requests from this machine; the
recorded Opus batch figure is 201 answers in 139 seconds.

### Would published Rotation change?

Recomputed with the existing `brand_week()` on each reading, then tested with the
existing `exceeds_noise()`. That test assumes two independent samples; here both
readings come from the same answers, so it is used only because it is the
publication's own bar, not as a significance claim.

| published run | brands that differ | beyond the noise test |
|---|---:|---|
| 2026-08-21 pokemon-grading | 12 | Beckett 84% to 73%, SGC 40% to 31%, PSA 99% to 93% |
| 2026-08-22 ai-coding-assistants | 13 | GitHub Copilot 64% to 87% |
| 2026-08-22 ai-writing-tools | 14 | Gemini 39% to 61%, ChatGPT 74% to 92%, Claude 78% to 94%, Grammarly 41% to 54%, Copilot 10% to 23% |
| 2026-08-24 ai-image-generators | 10 | DALL-E 27% to 54%, Imagen 26% to 44% |
| 2026-09-14 ai-coding-assistants | 23 | none |

Held records show the same pattern (DALL-E and Imagen up in every image week; GitHub
Copilot and Cursor up on 2026-08-24; JetBrains AI 2% to 6% on 2026-09-28).

Where the moves come from, counted over every answer-level difference behind them:

| kind of difference | upward moves | downward moves |
|---|---:|---:|
| Opus named it in a longer phrase that went to quarantine | 771 | 0 |
| Jev found it and Opus did not list it | 151 | 0 |
| Opus listed it and Jev called it context | 24 | 42 |
| Opus listed it and Jev called it something to avoid | 2 | 13 |
| Opus listed it and Jev called it not a company | 32 | 0 |

So the upward moves are mostly a quarantine boundary, not a reading difference, and
the downward moves are reading differences. The 151 genuine Jev-only finds are
concentrated in DALL-E (118 across all records): many sit in phrases like "OpenAI's
GPT Image 2.5" or "Microsoft Copilot / Designer (DALL·E 3)". Some of those may be
answers where Opus wrote "ChatGPT" or "OpenAI", which the image category excludes
and `normalize()` drops silently; stored records keep only normalized names, so this
cannot be confirmed from the archive.

### The most instructive disagreements

**1. Something to avoid** (`held/2026-09-28/ai-image-generators`, gemini q14 run 3).
Opus listed Adobe Firefly, Midjourney, Stable Diffusion, DALL-E. Jev listed Adobe
Firefly only, reading Midjourney as avoid (0.88):

> ### Why other popular tools (Midjourney, Stable Diffusion, DALL-E) are riskier:
> * **Midjourney & Stable Diffusion:** These tools were trained on massive open-web
> datasets (like LAION) that scraped billions of copyrighted images without
> creators' explicit permission.

`EXTRACT_PROMPT` says to ignore companies presented as something to avoid. Midjourney
and Stable Diffusion account for 72 of the 129 "Opus listed, Jev called avoid" cases,
55 of them on q14, "Which AI image generator is safest for licensing and copyright?"

**2. A close call** (`runs/2026-08-21/pokemon-grading`, claude q08 run 3). Jev split
PSA 0.51 avoid, 0.49 option:

> For a beginner in 2026, PSA (the traditional default) has become a bad first
> experience. **Why not PSA right now:** PSA stopped accepting every Value grading
> tier on June 2, 2026...

(quoted with the answer's dash replaced by parentheses). A labeller has to decide
this one; Jev's probabilities say it is genuinely split.

**3. Context, correctly** (`runs/2026-09-14/ai-coding-assistants`, perplexity q11
run 2). Opus listed Cursor; Jev called it context (0.83):

> If you tell me your editor (**VS Code, JetBrains, Cursor, terminal**) and whether
> you want **autocomplete**, **chat**, or **agentic multi-file edits**, I can give you
> the best single pick.

**4. Skip at the start** (`runs/2026-09-14/ai-coding-assistants`, claude-code q03
run 4). Opus listed Claude Code, Codex and Gemini Code Assist; Jev listed none of
the three, calling the Gemini CLI mention avoid (0.99):

> What I'd skip at the start: terminal agents like **Claude Code** (Anthropic, who
> makes me, flagging the conflict of interest), **OpenAI Codex CLI**, or **Gemini
> CLI**. ... Move to one after a couple months.

(quoted with the answer's dash replaced by a comma.)

This bears directly on the self-preference figures: it is Claude Code naming its own
maker's product, as something to defer.

**5. The quarantine boundary** (`runs/2026-08-22/ai-coding-assistants`, claude q06
run 4). Opus did not list GitHub Copilot; Jev did (1.00):

> **Best value for most people: GitHub Copilot Pro (~$10/month)**

This is the dominant cause of upward Rotation differences in the August runs. The
noise-word folding that would have resolved it was added to `normalize.py` after
those runs.

**6. A Jev error.** In 84 answers Opus listed a brand that Jev called "not a
company", 56 of them in the image category; Imagen, Adobe Firefly, Flux and Stable
Diffusion are the most common. These are usually close calls, for example
`runs/2026-08-24/ai-image-generators` chatgpt q14 run 3, where "Google Vertex AI Imagen
(developers/teams)" came back 0.53 not a company and 0.47 option. Low role confidence
is what a cascade would use to send such answers on to Opus.

### Checks on Jev itself

- **Option order.** The jaggedness notes say Jev can lean toward the first option.
  Re-asking 150 answers with the four role options reversed kept 629 of 636 brand
  judgments (98.9%); options went from 595 to 596.
- **Injection, refusal and off-topic screens.** Across the archive the highest
  injection score was 0.29 and no answer scored 0.5 on any of the three screens. On
  planted text the screens responded: a quoted page telling AI readers to recommend
  Zed scored 0.95, a direct "system note" naming Windsurf 0.99, and neither planted
  brand was listed; a refusal scored 0.99 and an off-topic travel answer 0.99. That
  shows the screens respond; it is not a measured detection rate.
- **Sentiment.** 1,491 of 15,565 shared brands (9.6%) differ in sentiment, almost all
  between neutral and positive (703 neutral to positive, 516 positive to neutral, 266
  neutral to negative). Sentiment is second-order and unused in any ranking.
- **Provenance.** Each reading records `jev-1.13.0` as returned by the API, SDK
  0.7.3, commit `9cda960`, the alias map used, and the source file's SHA-256. The
  commit carries a `-dirty` marker only because the reading files themselves were
  untracked while being written.

## Phase 2: labels

Scoring is wired: `review_extractions.py score <packet> --reading <shadow file>`
scores Jev on exactly the items the published reading is scored on, and refuses if a
reading was taken from a different version of a source file. Both readers stay
withheld until every item is labelled.

- The existing baseline packet is **75 answers** (median 242 words, 18,161 words in
  all). At one to two minutes per answer that is roughly **1.5 to 2.5 hours**.
- The two readers disagree on brand set or first brand in **19 of those 75**.
- Offer: a second, fresh packet drawn from answers where Jev and Opus disagree (for
  example 10 per kind of difference above), kept separate from the 75-item baseline,
  which stays as it is. That is where a label decides the most. No labels were
  supplied by me or by any model.

## Phase 3: uses that change no published number

- **Quarantine triage**: `python -m unprompted.jev_reader triage <date> --category <slug>`
  writes a suggested alias diff to `audit/jev-shadow/triage/`. Run on 2026-09-28
  coding: it proposes Lovable, Bolt, Bolt.new, v0, Google Antigravity and Graphite as
  new products; GLM, Qwen and GPT-6 Astra as not in the category; "JetBrains AI
  / Junie" as JetBrains AI. Some suggestions are doubtful at modest confidence ("Amp"
  to Sourcegraph Cody, 0.69; "Kimi" not in the category but "Kimi K3" a new product).
  It never writes to `aliases/`.
- **Answer health**: `python -m unprompted.jev_reader health <date> --category <slug>`
  lists injection, off-topic and refusal flags from a reading. Report only.
- **Second-reader alarm**: `python scripts/compare_jev.py alarm <date> --category <slug>`
  writes the week's agreement counts next to its shadow reading, for example
  `audit/jev-shadow/held/2026-09-28/ai-coding-assistants.alarm.json`. It is **not**
  wired into `scripts/weekly-run.cmd`, `data/last-run.json` or the notification;
  doing that needs your approval, and it must never hold a week.

## Phase 4: proposal only

### Method change and version bump

Adopting Jev as the published reader changes the extractor and the extraction
instructions, which the runner already refuses without a version bump. Every category
would move up one version (coding to 5; images and writing to 6). The frozen
methodology snapshot would record the reader (`jev-1.13.0`), the candidate rules, and
the full question set (role and sentiment definitions) in place of
`extraction_prompt`, so a later change to any of them is caught the same way.
Proposed `METHODOLOGY.md` text:

> ### Reader change (effective [date])
>
> From the week of [date], the stored answers are read by TypeSafe's Jev model
> (`jev-1.13.0`) instead of Claude Opus 5.5. Code first finds every name in the
> answer that the category's alias map knows, plus other product-like names, and
> fixes their order from where they first appear. Jev then decides, for each name,
> whether the answer presents it as an option, mentions it only as context, presents
> it as something to avoid, or is not naming a company at all, using the same
> definitions the previous extraction prompt used. Only options are counted. Brand
> names are normalised and quarantined exactly as before.
>
> A different reader is a different measurement, so every category takes a method
> version bump and week-over-week movement is not reported across the change. Before
> the change, both readers were compared on every stored answer and scored against
> the same human-labelled sample; the results are in `audit/`. Jev is not made by the
> company whose assistants appear on the chart, which removes the conflict described
> in "A conflict we have to declare" for the reading step. Agreement between the two
> readers is agreement, not proof that either is accurate.

### History: re-read or start a separate series

Re-reading the whole archive under Jev costs about $1.10 and two minutes, so cost is
not the constraint. **Recommendation: re-read the history** as new, append-only
records carrying their original `measured_on` and `source_run`, through the existing
`reextract` rules, so the new series is continuous under one reader from its first
week. The old readings stay where they are. The alternative, a clearly separate
series from the change date, is simpler to explain but leaves the chart with no
comparable history at the moment it changes.

Either way, decide the quarantine boundary first. The largest difference between the
two readings is not the reader but phrases like "GitHub Copilot Pro (~$10/month)"
that the alias map cannot resolve. Fixing that is an alias policy change on its own,
with its own version bump, and doing it in the same change as the reader would make
the two effects impossible to separate.

### SDE cascade

Jev reads every answer; any answer where a known brand's role confidence falls below
a threshold is also read by Opus, and the Opus reading is used for that answer. On
this archive, the share of answers that would escalate, and the resulting cost per
1,000 answers at the recorded Opus rate:

| threshold | answers escalated | approx. cost per 1,000 |
|---:|---:|---:|
| 0.5 | 11% | $1.83 |
| 0.6 | 15% | $2.41 |
| 0.7 | 21% | $3.24 |
| 0.8 | 27% | $4.05 |
| 0.9 | 39% | $5.68 |

The threshold should come from the Phase 2 labels: pick the lowest one at which the
cascade's accuracy is not worse than Opus alone. A cascade keeps Opus in the reading
path, so the declared conflict would remain for escalated answers.

### Disclosure wording for the method page

> Each answer is read by a model that decides which companies it presents as options.
> Since [date] that reader is Jev, a decision model made by TypeSafe, which is not one
> of the assistants on this chart. [If a cascade is used:] Answers the reader is
> unsure about are read again by Claude Opus 5.5, whose maker does appear on the chart.

### A new signal Jev makes cheap

Recommendation strength per brand, as a Score (for example: the answer's single top
pick; one of a few leading options; one of many; mentioned as a fallback). It would
add roughly one question per candidate, so cost would rise by about half, to about
$0.36 per 1,000 answers. It is a new measurement and would start its own series; it
would not change Rotation.

## Limits

- Agreement is not accuracy. Until the packet is labelled, nothing here says which
  reader is right.
- The comparison sees only Opus's normalized names; its raw names were not stored.
  "Opus named it in a longer phrase" is inferred from the record's quarantine list and
  the answer text, per answer.
- Older records' alias maps are recovered from git; two were measured from a dirty
  tree, so uncommitted alias edits at the time cannot be recovered.
- Jev is pinned to 1.13.0. A new version is a new reader and needs this comparison
  again.
