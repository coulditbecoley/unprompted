"""Re-parse a stored run without re-querying the engines.

The raw answers are on the record, so a corrected prompt or a widened alias map
costs a few cheap extraction calls rather than 225 engine calls and half an
hour. This is the payoff for storing answers.

Usage: python -m unprompted.reextract 2026-08-21 [--category pokemon-grading]
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .aggregate import brand_week, load_history
from .checks import run_checks
from .extract import extract_one
from .models import EngineAnswer, RunRecord
from .normalize import AliasMap, normalize
from .run import MAX_WORKERS, ROOT


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date")
    parser.add_argument("--category", default="pokemon-grading")
    args = parser.parse_args()

    path = ROOT / "data" / "runs" / args.date / f"{args.category}.json"
    record = json.loads(path.read_text(encoding="utf-8"))

    answers = [
        EngineAnswer(
            engine=e["engine"],
            question_id=e["question_id"],
            question="",
            run_index=e["run_index"],
            text=e.get("answer", ""),
            sources=e.get("sources", []),
            # A stored extraction failure is ours, not the engine's, so clear it
            # and retry. A genuine engine failure stays a failure: there is no
            # answer text to re-parse. Note that .get("error", "") is not enough,
            # because the key exists with a null value on every success.
            error=(
                None
                if (e.get("error") or "").startswith("extract failed")
                else e.get("error")
            ),
        )
        for e in record["extractions"]
    ]
    print(f"re-extracting {len(answers)} stored answers", file=sys.stderr, flush=True)

    extractions = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(extract_one, a) for a in answers]
        for done, future in enumerate(as_completed(futures), start=1):
            extractions.append(future.result())
            if done % 25 == 0 or done == len(futures):
                failed = sum(1 for e in extractions if e.error)
                print(f"  {done}/{len(futures)} ({failed} failed)", file=sys.stderr, flush=True)

    extractions.sort(key=lambda e: (e.question_id, e.engine, e.run_index))
    aliases = AliasMap.load(ROOT / "aliases" / f"{args.category}.yml")
    extractions, quarantined = normalize(extractions, aliases)

    fresh = RunRecord(
        category=record["category"],
        run_date=record["run_date"],
        method_version=record["method_version"],
        runs_per_question=record["runs_per_question"],
        engines=record["engines"],
        extractions=extractions,
        quarantined=quarantined,
    )

    history = [h for h in load_history(ROOT / "data" / "runs", args.category)
               if h["run_date"] != args.date]
    this_week = brand_week(fresh.to_dict())
    import yaml as _yaml

    spec = _yaml.safe_load(
        (ROOT / "questions" / f"{args.category}.yml").read_text(encoding="utf-8")
    )
    result = run_checks(
        fresh.to_dict(),
        this_week,
        brand_week(history[-1]) if history else [],
        max_brands=int(spec.get("max_brands", 15)),
    )

    path.write_text(
        json.dumps(fresh.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"\nrewrote {path.relative_to(ROOT)}", file=sys.stderr)

    print("\nSTANDINGS:", file=sys.stderr)
    for i, b in enumerate(this_week, 1):
        print(
            f"  {i:2}. {b.brand:<14} {b.named}/{b.total_runs}"
            f"  first {b.first_share:.0%}",
            file=sys.stderr,
        )

    if result.reasons:
        print("\nHELD:", file=sys.stderr)
        for r in result.reasons:
            print(f"  - {r}", file=sys.stderr)
        return 2

    print("\nAll checks passed. Clear to publish.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
