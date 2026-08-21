# Methodology

**Version 1** · effective 2026-08-21

Unprompted measures which brands AI assistants name when people ask real buying
questions, and publishes the result every week. This document is the method. It
is versioned, it lives in the same public repository as the data, and every run
record stamps the version it ran under.

---

## What we do, every week

1. A fixed bank of buyer questions is read from `questions/<category>.yml`.
2. Each question is asked of every active engine **five times**.
3. Every raw answer is stored, then parsed into a structured record: which brands
   were named, in what order, which sources were cited, and whether the engine
   declined to recommend anything.
4. Brand names are normalised against `aliases/<category>.yml`. Anything
   unrecognised is quarantined and **never appears on the chart**.
5. The run is appended to `data/runs/`. Nothing is ever overwritten or edited.
6. Four sanity checks run. If all pass, the site republishes. If any fail, the
   week is held and a human reviews it before anything is published.

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
rotation = times_named / total_runs
```

"Named in 8 of 10 runs" is a measurement. "Was named" is a coin flip written down.

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
| Google AI Overviews | Planned, via a SERP data provider | not yet active |

An engine that errors or returns nothing has that fact recorded as data. One
failing engine does not discard the week.

Where an engine declines to recommend anything, that is recorded as a refusal
rather than dropped. How often the machines refuse to answer a buying question is
itself worth knowing.

---

## Never break the series

The value of this publication is that week 40 can be honestly compared to week 1.

Changing the questions, the number of runs per question, or the list of active
engines changes what the numbers mean. Any such change **bumps the version at the
top of this file**, and either the history is re-run under the new method or a
clearly separate series begins.

The past is never edited. Run files are append-only, and the repository's public
git history is the audit trail.

---

## Disclosure

Unprompted is operated by Coley Grantham, who is commercially active in the
Pokémon hobby through No Bulk Cards. He is a **customer** of card grading
companies, not a competitor to them. No grading company has any input into the
questions asked, the method used, or the results published, and no placement on
this chart is or ever will be for sale.

The questions, the code, the raw answers and the full history are public in this
repository. Anyone can re-run the method and check the result.

---

## Corrections

If a result here is wrong, the raw data that produced it is in `data/runs/` and
the code that produced it is in `src/`. Open an issue. Corrections are made by
adding a new record, never by editing an old one.
