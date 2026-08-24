# Held runs

A run that fails its sanity checks lands here instead of `data/runs/`, with its
answers, extractions and quarantine list intact. Nothing in this directory is
read by the site.

It is committed rather than discarded because a failure is a measurement too:
the reason a week did not publish should be as auditable as the weeks that did.

To re-read a held run's stored answers without re-querying any engine:

    python -m unprompted.reextract <date> --category <slug>

If the re-read passes its checks it is written to `data/runs/` under today's
date, and publishes normally.

## 2026-08-23, ai-image-generators

Retracted, not originally held. Every one of its 225 extractions failed on an
Anthropic credit limit, so the run measured nothing. It reached `data/runs/` and
published a report reading "No brand was named this week" because the checks ran
*after* the writer rather than gating it — they had correctly flagged a 100%
error rate, and nothing acted on the result.

The record is unchanged from what was written; only its directory is corrected,
which is where the fixed pipeline would have put it. The report it produced was
removed, because it stated a market result that was never measured.
