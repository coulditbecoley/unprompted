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
is quarantined and never reaches the chart. Four sanity checks then run, and if
any of them trips, the week is held for a human instead of published.

Full detail, including what we deliberately do *not* measure, is in
[`METHODOLOGY.md`](METHODOLOGY.md).

---

## Running it yourself

```bash
pip install -e ".[dev]"
pytest                                  # 26 tests, no API keys needed

export ANTHROPIC_API_KEY=...            # at least one engine key
export OPENAI_API_KEY=...
export PERPLEXITY_API_KEY=...

python -m unprompted.run --category pokemon-grading --dry-run
```

`--dry-run` executes the full pipeline and reports the checks without writing
anything. Drop the flag to write a real run record.

Exit code `0` means the week is clear to publish. Exit code `2` means it was
held, and the reasons are printed.

---

## Disclosure

Unprompted is operated by Coley Grantham, who is commercially active in the
Pokémon hobby through No Bulk Cards. He is a **customer** of card grading
companies, not a competitor to them. No grading company has any input into the
questions, the method, or the results, and no placement on this chart is or ever
will be for sale.

If a result here is wrong, the data that produced it is in this repository.
Open an issue.

---

## Licence

Code is MIT. The data in `data/` is published under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — use it, cite it.

---

## Adding a category

Categories are grouped into sectors so a visitor sees the shape of the
publication before they see a list of slugs. Adding one is a data change, not a
code change:

1. Add an entry to `CATEGORIES` in [`lib/categories.ts`](lib/categories.ts),
   with `status: "planned"`.
2. Write `questions/<slug>.yml` — the buyer questions, a `method_version` and a
   `runs_per_question`.
3. Write `aliases/<slug>.yml` — `canonical` for the brands you will chart, and
   `exclude` for the things that are real but are not in this category.
4. Run it: `python -m unprompted.run --category <slug> --dry-run`
5. Once it has published a real week, flip `status` to `"live"`.

The board, the per-brand pages, the feed and the social card all come from the
registry, so no UI work is involved. A category listed as `planned` never claims
to have a chart it does not have.
