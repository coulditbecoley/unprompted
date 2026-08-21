"""The weekly orchestrator. Ask, extract, normalize, append, check, emit.

Writes exactly one dated file per category per run and never touches an existing
one. Exit code 0 means the site may publish; exit code 2 means the week is held.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import yaml

from .aggregate import brand_week, load_history
from .checks import run_checks
from .engines import ENGINES
from .extract import extract_one
from .models import RunRecord
from .normalize import AliasMap, normalize

ROOT = Path(__file__).resolve().parents[2]
HELD_EXIT_CODE = 2

# These are I/O-bound HTTP calls with very different latencies (Perplexity a few
# seconds, ChatGPT over a minute), so they run concurrently. Serially a full week
# is roughly 2.5 hours, which would blow the CI timeout and delay the chart for
# no reason. Kept modest so we stay well inside every provider's rate limits.
MAX_WORKERS = 6


def load_questions(category: str) -> dict:
    path = ROOT / "questions" / f"{category}.yml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def run_category(category: str, run_date: str, dry_run: bool = False) -> tuple[RunRecord, list[str]]:
    """Execute one full run. Returns the record and any hold reasons."""
    spec = load_questions(category)
    runs_per_question = int(spec["runs_per_question"])
    questions = spec["questions"]

    engines = {}
    for name, cls in ENGINES.items():
        engine = cls()
        if engine.is_configured:
            engines[name] = engine
        else:
            print(f"  engine '{name}' skipped: no API key present", file=sys.stderr)

    if not engines:
        raise SystemExit("no engines configured: set at least one provider API key")

    print(f"  engines active: {', '.join(sorted(engines))}", file=sys.stderr)

    tasks = [
        (engine, question["id"], question["text"], run_index)
        for question in questions
        for engine in engines.values()
        for run_index in range(runs_per_question)
    ]
    print(f"  {len(tasks)} calls across {len(engines)} engine(s)", file=sys.stderr)

    # as_completed rather than map: a twenty-minute run that prints nothing until
    # it finishes looks identical to a hung one, both here and in CI logs.
    answers = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {
            pool.submit(engine.ask_one, qid, text, run_index): engine.name
            for engine, qid, text, run_index in tasks
        }
        for done, future in enumerate(as_completed(futures), start=1):
            answers.append(future.result())
            if done % 10 == 0 or done == len(tasks):
                failed = sum(1 for a in answers if a.error)
                print(
                    f"  {done}/{len(tasks)} calls ({failed} failed)",
                    file=sys.stderr,
                    flush=True,
                )

    # Deterministic order regardless of which call finished first, so the run
    # file is stable and diffable.
    answers.sort(key=lambda a: (a.question_id, a.engine, a.run_index))

    for name in sorted(engines):
        got = [a for a in answers if a.engine == name]
        ok = sum(1 for a in got if not a.error)
        print(f"  {name}: {ok}/{len(got)} ok", file=sys.stderr)

    print(f"  extracting {len(answers)} answers", file=sys.stderr, flush=True)
    extractions = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(extract_one, a) for a in answers]
        for done, future in enumerate(as_completed(futures), start=1):
            extractions.append(future.result())
            if done % 25 == 0 or done == len(futures):
                failed = sum(1 for e in extractions if e.error)
                print(
                    f"  extracted {done}/{len(futures)} ({failed} failed)",
                    file=sys.stderr,
                    flush=True,
                )

    # as_completed returns out of order; restore a deterministic sort so the run
    # file stays stable and diffable.
    extractions.sort(key=lambda e: (e.question_id, e.engine, e.run_index))

    aliases = AliasMap.load(ROOT / "aliases" / f"{category}.yml")
    extractions, quarantined = normalize(extractions, aliases)

    record = RunRecord(
        category=category,
        run_date=run_date,
        method_version=int(spec["method_version"]),
        runs_per_question=runs_per_question,
        engines=sorted(engines),
        extractions=extractions,
        quarantined=quarantined,
    )

    history = load_history(ROOT / "data" / "runs", category)
    this_week = brand_week(record.to_dict())
    last_week = brand_week(history[-1]) if history else []
    result = run_checks(record.to_dict(), this_week, last_week)

    if not dry_run:
        out_dir = ROOT / "data" / "runs" / run_date
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{category}.json"
        if out_path.exists():
            raise SystemExit(
                f"refusing to overwrite {out_path}: run data is append-only"
            )
        out_path.write_text(
            json.dumps(record.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"  wrote {out_path.relative_to(ROOT)}", file=sys.stderr)

        if quarantined:
            qdir = ROOT / "data" / "quarantine"
            qdir.mkdir(parents=True, exist_ok=True)
            (qdir / f"{run_date}-{category}.json").write_text(
                json.dumps(sorted(set(quarantined)), indent=2) + "\n", encoding="utf-8"
            )

    return record, result.reasons


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one week of Unprompted.")
    parser.add_argument("--category", default="pokemon-grading")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--dry-run", action="store_true", help="do not write files")
    args = parser.parse_args()

    print(f"unprompted: {args.category} for {args.date}", file=sys.stderr)
    _, reasons = run_category(args.category, args.date, dry_run=args.dry_run)

    if reasons:
        print("\nHELD. This week will not publish:", file=sys.stderr)
        for reason in reasons:
            print(f"  - {reason}", file=sys.stderr)
        # Surface reasons to the workflow so it can open an issue.
        summary = os.environ.get("GITHUB_OUTPUT")
        if summary:
            with open(summary, "a", encoding="utf-8") as handle:
                handle.write("held=true\n")
                handle.write("reasons<<EOF\n" + "\n".join(reasons) + "\nEOF\n")
        return HELD_EXIT_CODE

    print("\nAll checks passed. Clear to publish.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
