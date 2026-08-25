"""Re-parse a stored run without re-querying the engines.

The raw answers are on the record, so a corrected prompt or a widened alias map
costs a few cheap extraction calls rather than 225 engine calls and half an
hour. This is the payoff for storing answers.

The rewritten run is a *new* dated file, never an overwrite. `data/runs` is the
public archive and the methodology calls it append-only; silently replacing a
week under the same path would make a published number unreproducible from the
repository that is supposed to prove it.

Usage: python -m unprompted.reextract 2026-08-22 --category ai-coding-assistants
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date

from .aggregate import brand_week, load_history
from .checks import run_checks
from .cli_provider import cli_extractor
from .extract import extract_run
from .models import EngineAnswer, RunRecord
from .normalize import AliasMap, normalize
from .extract import MODEL as EXTRACT_MODEL
from .run import MAX_WORKERS, ROOT, git_sha, load_local_env, persist


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("date")
    parser.add_argument("--category", required=True)
    parser.add_argument(
        "--out-date",
        help="date to write the re-extracted run under (default: today)",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="overwrite the source run instead of writing a new dated file. "
        "Only for a run that was never published.",
    )
    args = parser.parse_args()

    load_local_env()

    path = ROOT / "data" / "runs" / args.date / f"{args.category}.json"
    if not path.exists():
        # A held run is a re-extraction's most common subject: it was held
        # *because* something needed re-reading.
        held = ROOT / "data" / "held" / args.date / f"{args.category}.json"
        if not held.exists():
            raise SystemExit(f"no run at {path} or {held}")
        path = held
    # The help string said --in-place was "only for a run that was never
    # published" and nothing enforced it, so re-reading a published date with
    # --in-place overwrote the public archive at its own path. data/runs is the
    # thing the methodology calls append-only; the guarantee has to be code.
    published = path.parent.parent.name == "runs"
    if args.in_place and published:
        raise SystemExit(
            f"{path} is a published run and data/runs is append-only.\n"
            "Re-read it without --in-place to write a new dated file, or use "
            "--out-date to choose that date yourself."
        )

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
            # The engine's own token counts live on the stored extraction and
            # are not recoverable from anywhere else. Rebuilding the answer
            # without them made every re-extracted week report $0.00.
            usage={
                k: v
                for k, v in (e.get("usage") or {}).items()
                if not k.startswith("extract_")
            },
        )
        for e in record["extractions"]
    ]
    # Same reader the live pipeline would use, resolved once. Previously this
    # always took the hosted API path regardless of the registry, so a re-read
    # could silently use a different extractor from the run it was correcting.
    extractor = cli_extractor()
    print(f"re-extracting {len(answers)} stored answers", file=sys.stderr, flush=True)
    extractions = extract_run(answers, extractor, max_workers=MAX_WORKERS)

    extractions.sort(key=lambda e: (e.question_id, e.engine, e.run_index))
    aliases = AliasMap.load(ROOT / "aliases" / f"{args.category}.yml")
    extractions, quarantined = normalize(extractions, aliases)

    # A re-extraction is a new reading of the same answers, so it gets its own
    # dated file unless the operator says otherwise. --in-place exists for a run
    # that was never published, where correcting the original is the honest move.
    out_date = args.out_date or (args.date if args.in_place else date.today().isoformat())

    fresh = RunRecord(
        category=record["category"],
        run_date=out_date,
        method_version=record["method_version"],
        runs_per_question=record["runs_per_question"],
        engines=record["engines"],
        extractor=extractor.id if extractor else "api",
        extractor_model="" if extractor else EXTRACT_MODEL,
        # The answers were fetched when the source run fetched them. Dating a
        # re-read as if the engines were queried today put a day in the archive
        # on which nothing was asked, and made week-over-week movement compare a
        # re-reading against a real week.
        measured_on=record.get("measured_on") or record["run_date"],
        source_run=f"{record['run_date']}/{record['category']}",
        git_sha=git_sha(),
        extractions=extractions,
        quarantined=quarantined,
    )

    history = [
        h
        for h in load_history(ROOT / "data" / "runs", args.category)
        if h["run_date"] not in {args.date, out_date}
    ]
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
        previous=history[-1] if history else None,
    )

    # Same gate as a live run: a re-extraction that still fails its checks is
    # held, not published.
    try:
        persist(fresh, result.reasons, overwrite=args.in_place)
    except FileExistsError as exc:
        # A re-read is normally aimed at a date that already has a file, so this
        # is an ordinary mistake rather than a crash. --out-date is the answer.
        raise SystemExit(f"{exc}\nPass --out-date to write it under another date.")

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
