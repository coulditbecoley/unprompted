# Unprompted

**What AI recommends when nobody's paying.**

A free, public, weekly chart of which brands AI assistants actually name when
people ask real buying questions. Tracked every week, never edited.

Live at [unprompted.report](https://unprompted.report).

---

## Why this repository is public

The chart is only worth reading if you can check it. So everything that produces
it is here: the questions we ask, the code that asks them, every raw answer we
got back, and the full history.

- **The questions** — [`questions/`](questions/)
- **The method** — [`METHODOLOGY.md`](METHODOLOGY.md)
- **The raw data** — [`data/runs/`](data/runs/), append-only, one file per week
- **The code** — [`src/unprompted/`](src/unprompted/)

Nothing in `data/runs/` is ever modified after it is written. Corrections are
made by adding a new record. The git history is the audit trail.

---

## How it works

Every week, a scheduled job asks each question of every active engine **five
times**, because these systems do not give the same answer twice. We report how
*often* a brand was named, not whether it was named once.

That figure is **Rotation**:

```
rotation = times_named / total_runs
```

Brand names are normalised against [`aliases/`](aliases/). Anything unrecognised
is quarantined and never reaches the chart. Five sanity checks then run, and if
any of them trips, the week is held for a human instead of published.

Full detail, including what we deliberately do *not* measure, is in
[`METHODOLOGY.md`](METHODOLOGY.md).

---

## Running it yourself

```bash
pip install -e ".[dev]"
pytest                                  # no API keys needed

export ANTHROPIC_API_KEY=...            # every engine key: a missing one is
export OPENAI_API_KEY=...               # recorded as an error, not skipped,
export PERPLEXITY_API_KEY=...           # and will hold the week

python -m unprompted.run --category ai-coding-assistants --dry-run
```

`--dry-run` executes the full pipeline and reports the checks without writing
anything. Drop the flag to write a real run record.

### The web app's own keys

These are read from `.env.local`, which is gitignored, and must also be set in
the Vercel project for production. None of them is needed to run the pipeline
or the tests.

| Variable | Used by | Missing means |
|---|---|---|
| `ADMIN_PASSWORD` | `/admin` | the admin surface is closed entirely, not left open |
| `BUTTONDOWN_API_KEY` | the weekly email signup | signups fall back to the operator's inbox via Web3Forms |
| `NEXT_PUBLIC_WEB3FORMS_KEY` | the contact form | the form says so rather than failing silently |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | audience counting, rate limiting | nothing is counted and the dashboard says so; rate limiting fails open |

The Web3Forms key is public by design — the provider puts it in client HTML, so
every visitor can read it, and it is inlined into the JavaScript bundle at build
time. It is kept out of the repository anyway: this repo is public, and a key in
git history cannot be rotated by editing a file. Note that anyone who reads it
can post to that endpoint, so treat it as a spam surface rather than a secret.

`connect-src` in `vercel.json` must list any host a form or fetch talks to. The
CSP is `form-action 'self'`, so a native form POST to an external endpoint is
blocked outright; the contact form uses `fetch` for that reason and because a
native submit would navigate the reader away to the provider's response page.

**Web3Forms rejects server-side calls on the free plan** — "use our API in
client side" — so both forms call it from the browser. A Next route forwarding
to it fails every time while looking entirely reasonable, which is worth knowing
before writing one.

Until there is a mailing provider, the signup falls back to delivering the
address to the operator's inbox, subject `Unprompted: new subscriber`, so it is
filterable and exportable later. Setting `BUTTONDOWN_API_KEY` switches the route
to the real provider and the fallback stops firing on its own — no code change.

Exit code `0` means the week is clear to publish. Exit code `2` means at least
one category was held, and the reasons are printed.

A run that passes its checks is written to `data/runs/`, which the site reads. A
run that is held is written to `data/held/` instead, where it is kept for review
and never published. Re-read a held run's stored answers, without re-querying
any engine, with:

```bash
python -m unprompted.reextract 2026-08-23 --category ai-image-generators
```

### Local harnesses

Extraction is a mechanical reading job: it turns each stored prose answer into a
list of brands. It does not need web search, so it can run on a coding-agent CLI
already signed in on this machine instead of spending API credit. That path also
breaks a real dependency — an extractor hitting an API spend limit is what cost
the week of 2026-08-23.

Registered harnesses live in `providers.json` and are managed from `/admin`,
where "Scan this machine" finds what is installed and offers to add it in either
role.

A harness can hold **two different roles**, and they behave differently on
purpose:

| Role | What it does | If it is missing |
|---|---|---|
| **extractor** | Reads answers other engines gave. Never on the chart. | Falls back to the next extractor, then to the hosted API. |
| **engine** | Is asked the shopper's questions. Gets its own chart row. | The run refuses to start. |

The asymmetry is deliberate. Extraction is a mechanical reading job with a
hosted fallback that produces the same answer, so falling through costs money
rather than meaning. A missing *engine* changes which assistants answered, which
changes what the week means, so the run stops before spending anything.

| Harness | Command | Extractor | Engine |
|---|---|---|---|
| Claude Code | `claude` | fallback | on, charted |
| Codex | `codex` | fallback | on, charted |
| Gemini | `gemini` | allowlisted, unverified | — |

**Both local engines are on**, which is why the week runs on the operator's
machine rather than a GitHub runner: an enabled CLI engine has to exist wherever
the pipeline runs, and a runner has no local subscription. See
`scripts/weekly-run.cmd`. Turning one off changes the engine list, which is a
method change, and a check holds the week if the two disagree.

**Extraction no longer runs through a local harness.** The hosted API extractor
is first in `providers.json` and reads a whole run as one Batch API job; the two
CLIs sit below it as fallbacks for a machine with no key. A harness call carried
roughly 48k tokens of its own context to do about 900 tokens of work, which is
where a subscription's allowance went. Registry order is priority, and the
`/admin` dashboard marks which extractor will actually run.

A local engine is charted under its own name and never substitutes for the
hosted engine it resembles; `METHODOLOGY.md` explains why they are different
products. It contributes no citations and no token costs.

Their arguments are **pinned, not merely permitted**, in two places that a test
keeps in sync: `KNOWN_CLIS` in `lib/providers.ts` (what the admin dashboard will
commit) and `ALLOWED_CLIS` in `src/unprompted/cli_provider.py` (what will
actually be run). The arguments are the harness's safety settings as much as its
plumbing, so adding or changing one is a reviewed code change, not a dashboard
edit.

The prompt handed to a harness contains a verbatim answer from a model that
searched the open web, so it is untrusted text going to an agent that can read
files and run commands. Two containments apply to every harness:

- it runs in an **empty temporary directory**, so the repository and the
  operator's other projects are not reachable by a relative path;
- it runs with a **scrubbed environment**, so no provider key or `GITHUB_TOKEN`
  is readable by the process.

Neither is a sandbox — a harness can still reach the network and the wider
filesystem by absolute path. Per-harness flags in the allowlist remove more
(`--strict-mcp-config` for Claude; `--ignore-user-config --ignore-rules
--sandbox read-only` for Codex). Note that `claude --tools ""` is **not** relied
on: its help says it disables all tools, and it was observed reading a file from
disk anyway.

---

## Disclosure

Unprompted is operated by [Skald Studio](https://skaldstudio.io), which sells
AI visibility work: helping companies get named by AI assistants. That is a real
conflict with a chart measuring exactly that, so it is stated on every page of
the site rather than buried here.

No company on any chart has input into the questions, the method, or the
results, no placement is or ever will be for sale, and no charted company is a
Skald Studio client.

If a result here is wrong, the data that produced it is in this repository.
Open an issue.

---

## Licence

Code is MIT. The data in `data/` is published under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — use it, cite it.

---

## Who reads it

`/admin` carries an Audience section. It counts two things separately because
they answer different questions.

**Agents come from the request itself**, in `proxy.ts`. That is the only place
they are visible: GPTBot, ClaudeBot and PerplexityBot fetch the HTML and leave
without running a line of script, so every client-side analytics product reports
zero of them. The list of agents this build can name lives in
[`agents.json`](agents.json), shared by the TypeScript that classifies a request
and the Python that archives the counts.

Within agents the split that matters is **why** the fetch happened.
`ChatGPT-User`, `Claude-User` and `Perplexity-User` mean a person asked a
question and this page was read to answer them; `GPTBot` and `CCBot` mean a
crawler passed through. A combined "bot traffic" number would destroy both.

**People come from a beacon** that runs after render. No cookie is set, no
identifier is minted, no address is stored, and a referrer is reduced to a
hostname server-side.

Counters live in Upstash Redis and expire after ninety days, which is right for
a cache and wrong for a record. `scripts/sync_analytics.py` copies each day into
the Obsidian vault before it ages out — raw JSON as the source of truth, a
readable note per day, and an index carrying all-time totals. It runs from the
daily vault sync and again at the end of a weekly run, and is idempotent. A day
that has aged out of Redis keeps whatever was archived while it was there; the
archive only ever grows.

## Audits

[`AUDIT-REPORT.md`](AUDIT-REPORT.md) is an independent audit of the whole
project — security, system quality, code quality — run by a separate agent
against commit `4e39653` and published unedited, including the parts that are
unflattering. Its header records what has been fixed since and what is still
open. If you find something it missed, that is worth more to this project than
a kind word.

## Adding a category

Categories are grouped into sectors so a visitor sees the shape of the
publication before they see a list of slugs. Adding one is a data change, not a
code change:

1. Add an entry to `CATEGORIES` in [`lib/categories.ts`](lib/categories.ts).
2. Write `questions/<slug>.yml` — the buyer questions, a `method_version` and a
   `runs_per_question`.
3. Write `aliases/<slug>.yml` — `canonical` for the brands you will chart, and
   `exclude` for the things that are real but are not in this category.
4. Run it: `python -m unprompted.run --category <slug> --dry-run`

There is no `status` field to flip. Whether a category is live is a fact already
on disk — it has run data or it does not — and a hand-maintained flag beside
that fact can only be right by accident.

The board, the per-brand pages, the feed and the social card all come from the
registry, so no UI work is involved. A category with no run data never claims to
have a chart it does not have.
