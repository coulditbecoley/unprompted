# Methodology

**Version 2** · effective 2026-08-24

Unprompted measures which brands AI assistants name when people ask real buying
questions, and publishes the result every week. This document is the method. It
is versioned, it lives in the same public repository as the data, and every run
record stamps the version it ran under.

---

## What we do, every week

1. A fixed bank of buyer questions is read from `questions/<category>.yml`.
2. Each question is asked of every active engine **five times**.
3. Every raw answer is read into a structured record: which brands were named,
   in what order, which sources were cited, and whether the engine declined to
   recommend anything. The verbatim answer is kept on that record, so every
   published number can be re-derived from the text it came from.
4. Brand names are normalised against `aliases/<category>.yml`. Anything
   unrecognised is quarantined and **never appears on the chart**.
5. Six sanity checks run, **before anything is written**.
6. A run that passes is appended to `data/runs/` and the site republishes. A run
   that fails is written to `data/held/` instead, where it is kept in full for
   review and is not read by the site. Nothing in either directory is ever
   overwritten or edited.

The order of steps 5 and 6 is the point. The checks decide where a run lands,
not merely whether someone is told about it.

One honest caveat about step 3: answers are held in memory until the run is
complete, so a machine that loses power mid-run loses that run's answers rather
than writing a partial week. Nothing incomplete is ever published, but nothing
incomplete is recovered either.

---

## Why we ask five times instead of once

These systems do not give the same answer twice. Ask the same question on Monday
and Wednesday and you can get different brands. Google's AI Overviews sometimes
do not appear at all for the same query on consecutive requests.

Asking once and publishing the result would be publishing noise. So each question
is asked repeatedly and we report **how often** a brand appeared, not whether it
appeared.

That figure is called **Rotation**:

```
rotation = times_named / answered_runs
```

`answered_runs` is the runs that produced an answer: attempts where the engine
errored, and attempts where it declined to recommend anything, are not in the
denominator. This is deliberate and it is the one place the figure is not simply
"out of five". An engine outage would otherwise read as every brand losing
ground in the same week, which is a fact about the provider, not about the
brands. The counts it is built from — answered, refused and errored — are on
every run record, so the denominator can always be checked.

Because that exclusion could hide a broken engine, no engine is allowed to fail
more than 20% of its own calls: past that the week is held rather than published
against a thinner sample. See the checks below.

"Named in 8 of 10 runs" is a measurement. "Was named" is a coin flip written down.

### Why an engine has to search

Every hosted engine on this chart looks things up before answering: across the
archive, Perplexity and Claude cite sources on 100% of answers and ChatGPT on
95%. That is not incidental. A model answering from memory reports which brands
it absorbed in training; a model that searches reports which brands are findable
today. Both are real questions and they are not the same one, and a chart that
mixed them would answer neither.

Gemini was evaluated as a fourth engine on 2026-08-26 and is not included, for
reasons worth recording because they are not obvious from the outside:

- `gemini-3.5-flash` grounds every answer it gives, and failed **31%** of a full
  week with `503 UNAVAILABLE` — five of eight even when called one at a time, so
  the overload is Google's rather than our request rate. Past the 20% rule above,
  that engine holds every week it takes part in.
- `gemini-3.6-flash` answers reliably and chooses to search on roughly a fifth of
  calls. It would look healthy on every dashboard while measuring the other
  question.
- Grounding cannot be required. `google_search_retrieval` with a zero dynamic
  threshold returns `400 not supported`, and `tool_config` in `ANY` mode times
  out. Whether a Gemini model searches is the model's decision, per call.
- The entire 2.5 line — `2.5-pro`, `2.5-flash`, `2.5-flash-lite` — answers `404`
  for a key issued now: "no longer available to new users."

The adapter is written, tested and kept, disabled in `providers.json` with that
note attached. This is a fact about Gemini's current API, not a permanent
judgement, and it should be re-measured rather than assumed.

## How much of a change is real

Fifteen questions asked five times is a small sample, and a share drawn from a
small sample wobbles. At 225 answered runs, a figure near 30% carries a 95%
interval of roughly **six percentage points**. A brand that "moves" four points
between Mondays has, more likely than not, not moved at all.

So a week-over-week change is only drawn as movement, and a brand is only named
The Snub, when the change is larger than the sample can explain by chance — the
usual two-proportion test at 95%. A change that does not clear that bar is still
printed, in grey, with a sign and no arrow: hiding it would be its own kind of
dishonesty, but calling it a move would be worse.

This is a floor under what gets reported rather than a claim of statistical
rigour. Five repeats of one question in one week are not five independent draws,
so treat the interval as the smallest honest uncertainty, not the whole of it.

A brand that was named last week and not once this week is a disappearance
rather than a wobble, and always counts.

---

## What we measure, and what we do not

We query each provider's API, using that provider's own web search where it
exists. **This is not identical to what a logged-in person sees in the consumer
app.** Consumer products carry their own system prompts, personalisation,
shopping integrations and safety layers that an API does not reproduce.

Every tool in this market shares that limitation. We are stating it because none
of them do.

We deliberately do **not** route requests through a multi-provider aggregator.
Aggregators supply one shared search context to every model, which would make the
engines agree with each other artificially and would report the aggregator's
sources rather than each assistant's own. The disagreement between assistants is
the thing worth measuring, so each engine is queried natively.

---

## Active engines

| Engine | How it is queried | Status |
|---|---|---|
| ChatGPT | OpenAI API with OpenAI's own web search | v1 |
| Claude | Anthropic API with Anthropic's web search | v1 |
| Perplexity | Perplexity Sonar API | v1 |
| Claude Code | Local CLI harness on the operator's machine | v2 |
| Codex | Local CLI harness on the operator's machine | v2 |
| Google AI Overviews | Planned, via a SERP data provider | not yet active |

**A local harness is charted as its own engine, never as a stand-in for the
hosted engine of a similar name.** `claude -p` is Claude Code, a coding agent
with a coding agent's system prompt: asked what the best AI coding assistant is,
it volunteers "I'm made by Anthropic, so take my read on Claude products with
that in mind", which the consumer assistant does not do. `codex` is not ChatGPT,
and in testing it ranked Claude Code above OpenAI's own Codex. Treating either as
interchangeable with its hosted namesake would change what a row means partway
through a series.

Two things a local engine cannot report, both visible in the data rather than
hidden: it returns **no citations**, so it contributes nothing to the source
counts; and it reports no token usage, so the cost report shows $0.00 for it,
which is accurate because those calls are billed to a subscription.

Turning a local engine on changes the engine list, which is a method version
bump. That rule is now enforced rather than merely written down: a run whose
engine list differs from the previous week's without a version bump is held.

An engine that errors or returns nothing has that fact recorded as data. One
failing call does not discard the week; enough of them do. Two of the six checks
cover this: more than 20% of all calls failing holds the week, and separately,
any single engine failing more than 20% of *its own* calls holds it. The second
exists because the first cannot see one broken engine — with five engines, one
that fails every call is only 20% of the run.

An engine whose credentials are missing is queried anyway and its calls are
recorded as errors, rather than being dropped from the run. Dropping them would
let a vanished key quietly change which engines the week was measured across —
exactly the change "Never break the series" below says must never happen
silently.

Where an engine declines to recommend anything, that is recorded as a refusal
rather than dropped. How often the machines refuse to answer a buying question is
itself worth knowing.

**Agreement between engines is reported, not averaged away.** A single ranking
hides the fact that the engines often name different brands first for the same
question. `/consensus` reports each engine's pick per question, and the share of
questions on which they all agree. It is derived from the same run records as
the board and introduces no new measurement.

**Sentiment is second-order and labelled as such.** Every brand mention carries
positive, neutral or negative, but that reading is made by the extraction model
from the engine's prose, not stated by the engine itself. It is weaker evidence
than a name count, it is never used in Rotation or in any ranking, and every
place it appears carries a sentence saying where it came from.

---

## Never break the series

The value of this publication is that week 40 can be honestly compared to week 1.

Changing the questions, the number of runs per question, or the list of active
engines changes what the numbers mean. Any such change **bumps the version at the
top of this file**, and either the history is re-run under the new method or a
clearly separate series begins.

Only the engine-list rule is currently enforced in code; the others are a
commitment kept by the operator, and that difference is stated here rather than
implied to be automatic.

Every run also records the commit it ran from, the model that read the answers,
and the date the engines were actually queried. Re-reading stored answers with a
corrected alias map produces a **new** file that carries the original
measurement date and a pointer to the run it was read from, so a re-reading is
never mistaken for a fresh week.

The past is never edited. `data/runs/` is append-only and the tooling refuses to
write over anything in it, including on a re-read. The repository's public git
history is the audit trail.

---

## Disclosure

Unprompted is operated by [Skald Studio](https://skaldstudio.io), which sells
AI visibility work: helping companies get named by AI assistants. That is a
real conflict with a chart measuring exactly that, so it is stated on every
page of the site rather than buried here.

What it does not touch: no company on any chart has input into the questions
asked, the method used, or the results published, and no placement is or ever
will be for sale. No charted company is a Skald Studio client.

The questions, the code, the raw answers and the full history are public in this
repository. Anyone can re-run the method and check the result.

---

## A conflict we have to declare

In the AI tools categories, some of the products we chart are made by the same
companies whose assistants we query. We report the gap between how often an
engine names its own product and how often rivals name it.

That measurement has a problem we did not choose and cannot fully remove:
**the extraction step also runs on Claude by default.** After each engine
answers, a Claude model reads that prose and decides which companies were named.
So when the result says Claude named Claude Code more often than rivals did, a
Claude model was the one counting.

Which reader ran is no longer implicit: every run record carries an `extractor`
field naming it, and the weekly note prints it in its frontmatter.

We think the effect is small, because extraction is a mechanical reading task
and the raw answers are published alongside the counts, so anyone can check a
row by hand. But "we think it is small" is not evidence, and the honest position
is that this figure carries a conflict until it has been checked with a
different model doing the extraction.

That check is now runnable rather than hypothetical. A second local harness
(Codex) is registered as an extractor, and because every raw answer is stored, a
past week can be re-read by the other harness without re-querying any engine:

    python -m unprompted.reextract <date> --category <slug>

with the other extractor enabled in `providers.json`. Comparing the two
resulting records is the cross-extractor check. Until it has been run over a
full week and published, treat any self-preference number involving Claude as
provisional. The raw answers behind every count are in `data/runs/`, which is
exactly why they are published.

Two things that are *not* affected by this: the standings themselves, which do
not depend on whose product is whose, and the ChatGPT figure, where a Claude
extractor finding that ChatGPT under-names its own product runs against the
direction any bias would push.

---

## Corrections

If a result here is wrong, the raw data that produced it is in `data/runs/` and
the code that produced it is in `src/`. Open an issue. Corrections are made by
adding a new record, never by editing an old one.
