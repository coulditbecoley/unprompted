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

import yaml

from .aggregate import brand_week, load_history
from .checks import run_checks
from .budget import check as check_budget
from .cli_provider import ApiExtractor, ProviderError, resolve_extractor
from .engines import all_engines
from .extract import EXTRACT_PROMPT, extract_run
from .models import EngineAnswer, RunRecord
from .normalize import AliasMap, normalize
from .run import MAX_WORKERS, ROOT, git_sha, load_local_env, persist
from .storage import run_lock


def main() -> int:
    with run_lock(ROOT / ".unprompted"):
        return _main()


def _main() -> int:
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
        help="retired: use --out-date to preserve earlier readings and usage",
    )
    args = parser.parse_args()

    if args.in_place:
        raise SystemExit("In-place recovery would erase earlier usage. Use --out-date to create a new reading; the source is preserved.")

    load_local_env()
    date.fromisoformat(args.date)
    if args.category not in {p.stem for p in (ROOT / "questions").glob("*.yml")}:
        raise SystemExit("unknown category")
    out_date = args.out_date or date.today().isoformat()
    date.fromisoformat(out_date)
    for bucket in ("runs", "held"):
        target = ROOT / "data" / bucket / out_date / f"{args.category}.json"
        if target.exists():
            raise SystemExit(f"refusing existing destination before extraction: {target}")

    path = ROOT / "data" / "runs" / args.date / f"{args.category}.json"
    if not path.exists():
        # A held run is a re-extraction's most common subject: it was held
        # *because* something needed re-reading.
        held = ROOT / "data" / "held" / args.date / f"{args.category}.json"
        if not held.exists():
            raise SystemExit(f"no run at {path} or {held}")
        path = held
    record = json.loads(path.read_text(encoding="utf-8"))
    if record.get("category") != args.category or record.get("run_date") != args.date:
        raise SystemExit("source record identity does not match its path")

    # Freeze and validate the actual alias policy before extraction can cost
    # anything. An operator edit during a batch must not change this reading.
    alias_data = yaml.safe_load((ROOT / "aliases" / f"{args.category}.yml").read_text(encoding="utf-8")) or {}
    aliases = AliasMap(alias_data.get("canonical", {}), alias_data.get("exclude", []))
    spec = record.get("methodology", {}).get("questions") or yaml.safe_load(
        (ROOT / "questions" / f"{args.category}.yml").read_text(encoding="utf-8")
    )
    reading_commit = git_sha()

    answers = [
        EngineAnswer(
            engine=e["engine"],
            question_id=e["question_id"],
            question="",
            run_index=e["run_index"],
            text=e.get("answer", ""),
            sources=e.get("sources", []),
            source_kind=e.get("source_kind", "unspecified"),
            fetched_at=e.get("fetched_at", ""),
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
    try:
        extractor = resolve_extractor()
    except ProviderError as exc:
        raise SystemExit(str(exc)) from exc
    hosted = isinstance(extractor, ApiExtractor)
    verdict = check_budget(args.category, len(answers))
    if not verdict.ok:
        raise SystemExit(f"Refusing re-extraction.\n{verdict.message}")
    print(
        f"re-extracting {len(answers)} stored answers via {extractor.label}",
        file=sys.stderr,
        flush=True,
    )
    extractions = extract_run(
        answers,
        None if hosted else extractor,
        max_workers=MAX_WORKERS,
        model=extractor.model if hosted else None,
        checkpoint=ROOT / ".unprompted" / "reextract" / out_date / args.category / "batch.json",
    )

    extractions.sort(key=lambda e: (e.question_id, e.engine, e.run_index))
    extractions, quarantined = normalize(extractions, aliases)

    methodology = {**record.get("methodology", {}),
                   "extraction_prompt": EXTRACT_PROMPT,
                   "extractor": {"id": extractor.id, "model": extractor.model if hosted else ""},
                   "aliases": alias_data}

    fresh = RunRecord(
        category=record["category"],
        run_date=out_date,
        method_version=record["method_version"],
        runs_per_question=record["runs_per_question"],
        engines=record["engines"],
        extractor=extractor.id,
        extractor_model=extractor.model if hosted else "",
        # The answers were fetched when the source run fetched them. Dating a
        # re-read as if the engines were queried today put a day in the archive
        # on which nothing was asked, and made week-over-week movement compare a
        # re-reading against a real week.
        measured_on=record.get("measured_on") or record["run_date"],
        source_run=f"{record['run_date']}/{record['category']}",
        git_sha=reading_commit,
        methodology=methodology,
        extractions=extractions,
        quarantined=quarantined,
    )

    history = [
        h
        for h in load_history(ROOT / "data" / "runs", args.category)
        if (h.get("measured_on") or h["run_date"]) < (record.get("measured_on") or record["run_date"])
    ]
    this_week = brand_week(fresh.to_dict())
    result = run_checks(
        fresh.to_dict(),
        this_week,
        brand_week(history[-1]) if history else [],
        max_brands=int(spec.get("max_brands", 15)),
        previous=history[-1] if history else None,
        # Re-extraction re-reads stored answers and never re-queries an engine,
        # so the sources in the record are the ones the engine gave on the day.
        # The grounding rule applies exactly as it did then, and reading the
        # flag off the live engines keeps one definition of who searches.
        grounding_engines=({name for name, settings in record["methodology"]["engines"].items() if settings.get("grounds")}
                           if record.get("methodology", {}).get("engines") else
                           {name for name, e in all_engines().items() if e.grounds}),
    )

    # Same gate as a live run: a re-extraction that still fails its checks is
    # held, not published.
    try:
        persist(fresh, result.reasons)
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
