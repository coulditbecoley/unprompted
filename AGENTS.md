<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working on Unprompted

A weekly measurement of which brands AI assistants name for real buying
questions. Python pipeline in `src/unprompted/` and `scripts/`; Next.js site in
`app/`, `components/`, `lib/` (reads the JSON in `data/runs/`).
`METHODOLOGY.md` is the method and wins any conflict with code comments.

**Tests (free, offline):** `python -m pytest -q` · `npm run typecheck` · `npm test`
(the web tests also check Python and TypeScript agree on every published file).

**What costs money.** Free: `python -m unprompted.run --preflight`,
`--collect-only` (downloads batches already paid for), `unprompted.reextract
--renormalize` (re-applies aliases to stored raw names), `unprompted.report`,
`scripts/watchdog.py`, the tests. Paid: `python -m unprompted.run` *including*
`--dry-run` (it still asks every engine), `unprompted.reextract` without
`--renormalize`,
`unprompted.jev_reader`, `scripts/compare_jev.py --read`. Never start a paid
command to fill a gap; report the gap.

**Before a Monday.** `python -m unprompted.run --preflight --qualify` runs what
the weekly run checks first: each local engine's isolation canary, the model
every engine reports, and the run's full method-change comparison (real
calls: two per local harness on the subscription, and Gemini's model probe,
up to three tiny attempts; nothing is measured).

**The weekly run.** `scripts/weekly-run.cmd`, Mondays 13:00 via Windows Task
Scheduler on the operator's machine (two engines are local CLIs signed in
there). Outcome per category: `data/last-run.json` → `categories`. Exit codes:
0 all passed · 1 the launcher or `--collect-only` stopped before measuring ·
2 at least one category held, failed or not started (passed ones still
publish; argparse usage errors also exit 2) · 3 measured but commit/push failed.

**Where state lives.** `data/runs/<date>/<category>.json` published (never edit
by hand) · `data/held/` held readings, kept as evidence · `data/quarantine/`
unrecognised brand names · `.unprompted/` local checkpoints and batch state
(gitignored; never delete: paid answers live there) · `private/` paid reports
and newsletter drafts (gitignored).

**Rules that are easy to break.**
- Changing questions, engines, an engine's model, prompt or CLI arguments, or
  the extractor is a method change: bump `method_version` in `questions/*.yml`
  and add a dated section to `METHODOLOGY.md`. The runner refuses otherwise.
- An "unaccounted batch" refusal is fixed with `python -m unprompted.run
  --collect-only`, never by deleting the checkpoint. If it reports a
  submission with no batch id, the owner reconciles it in the provider
  console; nothing is resubmitted.
- Alias decisions (`aliases/`) are the owner's; propose, don't commit.
- The CLI engines' arguments in `src/unprompted/cli_provider.py` are their
  isolation; probe any change against the real binary.

**Historical documents.** `AUDIT-REPORT*.md`, `UPGRADE-PLAN.md`,
`UPGRADE-LOOP.md`, `RECOVERY-PLAN.md`, `READING-REVIEW.md` and `PRODUCT.md`
are dated records, not current instructions.
