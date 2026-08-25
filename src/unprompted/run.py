"""The weekly orchestrator. Ask, extract, normalize, append, check, emit.

Writes exactly one dated file per category per run and never touches an existing
one. A run that passes its checks lands in data/runs, which the site reads; a
run that is held lands in data/held, which nothing reads. Exit code 0 means
every category published; exit code 2 means at least one was held.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

import yaml

from .aggregate import brand_week, load_history
from .checks import run_checks
from .cost import cost_of_run, format_report
from .engines import all_engines
from .cli_provider import cli_extractor
from .extract import MODEL as EXTRACT_MODEL, extract_run
from .models import RunRecord
from .normalize import AliasMap, normalize
from .report import write_report

ROOT = Path(__file__).resolve().parents[2]
HELD_EXIT_CODE = 2

# These are I/O-bound HTTP calls with very different latencies (Perplexity a few
# seconds, ChatGPT over a minute), so they run concurrently. Serially a full week
# is roughly 2.5 hours, which would blow the CI timeout and delay the chart for
# no reason. Kept modest so we stay well inside every provider's rate limits.
MAX_WORKERS = 6


def load_local_env() -> None:
    """Read .env.local into the environment, without overriding what is set.

    The keys live in that file because the web app reads them there, but nothing
    put them in front of the pipeline, so a scheduled task on this machine
    started with no credentials at all. Real environment variables always win,
    so CI is unaffected.
    """
    path = ROOT / ".env.local"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def git_sha() -> str:
    """The commit this run executed from, or "" if that cannot be determined.

    Questions, alias maps and prompts all live in the repository, so the commit
    is what makes a published week reproducible: without it, two runs on the
    same day are indistinguishable from each other. A dirty tree is marked,
    because a run from uncommitted code is not reproducible at all and saying so
    is more useful than a SHA that does not describe what ran.
    """
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT, capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT, capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
        return f"{sha}-dirty" if dirty else sha
    except Exception:  # noqa: BLE001 - provenance is best effort, never fatal
        return ""


def load_questions(category: str) -> dict:
    path = ROOT / "questions" / f"{category}.yml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def run_category(category: str, run_date: str, dry_run: bool = False) -> tuple[RunRecord, list[str]]:
    """Execute one full run. Returns the record and any hold reasons."""
    spec = load_questions(category)
    runs_per_question = int(spec["runs_per_question"])
    questions = spec["questions"]

    # Pre-flight. Which assistants answered is part of what a week means, so a
    # declared engine this machine cannot query is a reason to stop before
    # spending anything, not to quietly measure a smaller field and publish it.
    #
    # Checked up front rather than discovered call by call: the previous
    # behaviour skipped an unconfigured engine outright, so a vanished secret
    # silently changed the population; recording 75 errors instead would have
    # caught it, but only after paying for the other 150 calls.
    engines = all_engines()
    unavailable = sorted(
        (name for name, e in engines.items() if not e.is_configured),
        key=str,
    )
    if unavailable:
        detail = "\n".join(
            f"  - {name}: {engines[name].unavailable_reason}" for name in unavailable
        )
        raise SystemExit(
            f"{len(unavailable)} of {len(engines)} declared engines cannot be "
            f"queried on this machine:\n{detail}\n"
            "Every declared engine must answer, or the week measures a different "
            "field from the weeks around it. Fix the credential or the PATH, or "
            "disable that engine in providers.json and bump the method version."
        )

    print(f"  engines queried: {', '.join(sorted(engines))}", file=sys.stderr)

    # Same pre-flight, same reason. Extraction happens after every engine call
    # has been paid for, so an extractor that cannot run is found at the worst
    # possible moment: a full run's spend with nothing readable at the end of
    # it. Resolved here rather than at the point of use so the failure is free.
    extractor = cli_extractor()
    if extractor is None and not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit(
            "the API extractor is first in providers.json but ANTHROPIC_API_KEY "
            "is not set.\nSet the key, or enable a local extractor in "
            "providers.json to read this run instead."
        )
    print(
        f"  extractor: {extractor.label if extractor else 'Claude (API, batch)'}",
        file=sys.stderr,
    )

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

    extractions = extract_run(answers, extractor, max_workers=MAX_WORKERS)

    # The live path returns out of order; restore a deterministic sort so the
    # run file stays stable and diffable.
    extractions.sort(key=lambda e: (e.question_id, e.engine, e.run_index))

    aliases = AliasMap.load(ROOT / "aliases" / f"{category}.yml")
    extractions, quarantined = normalize(extractions, aliases)

    record = RunRecord(
        category=category,
        run_date=run_date,
        method_version=int(spec["method_version"]),
        runs_per_question=runs_per_question,
        engines=sorted(engines),
        extractor=extractor.id if extractor else "api",
        extractor_model="" if extractor else EXTRACT_MODEL,
        measured_on=run_date,
        git_sha=git_sha(),
        extractions=extractions,
        quarantined=quarantined,
    )

    history = load_history(ROOT / "data" / "runs", category)
    this_week = brand_week(record.to_dict())
    last_week = brand_week(history[-1]) if history else []
    result = run_checks(
        record.to_dict(),
        this_week,
        last_week,
        max_brands=int(spec.get("max_brands", 15)),
        previous=history[-1] if history else None,
    )

    if not dry_run:
        persist(record, result.reasons)

    return record, result.reasons


def persist(record: RunRecord, reasons: list[str], overwrite: bool = False) -> Path:
    """Write one run to disk, on the side of the line its checks put it.

    The checks decide *where* a run lands, not merely whether a human is paged.
    A held run written into data/runs is published by the next `git add data/`,
    which is how a week with a 100% error rate reached the site reading "no
    brand was named". Held runs go to data/held: kept for review and for the
    archive, invisible to the site, which reads only data/runs.

    Shared with reextract so a second write path cannot drift back to the far
    side of this gate.
    """
    held = bool(reasons)
    data = record.to_dict()
    out_dir = ROOT / "data" / ("held" if held else "runs") / record.run_date
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{record.category}.json"
    if out_path.exists() and not overwrite:
        # Not SystemExit. This is a condition of one category, and killing the
        # process here cost a real week: on 2026-08-24 a leftover held file
        # aborted the run after ai-image-generators had already paid for 375
        # engine calls, and ai-writing-tools never ran at all. FileExistsError
        # is caught per category by main(), so the rest of the week continues
        # and everything that did publish still gets committed.
        raise FileExistsError(
            f"refusing to overwrite {out_path}: run data is append-only"
        )
    out_path.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"  wrote {out_path.relative_to(ROOT)}", file=sys.stderr)

    # The readable note lives beside the data so the scheduled cloud run
    # produces it too, not just a local run. A held run gets no report: the
    # report is the published artefact, and publishing is what is withheld.
    if not held:
        report_path = write_report(data, ROOT)
        print(f"  wrote {report_path.relative_to(ROOT)}", file=sys.stderr)

    # Quarantine is written either way. It is the operator's to-do list, and a
    # held week is exactly when it needs reading. Every occurrence, not the
    # distinct set: the triage signal is how often a name appeared, and
    # deduplicating here made every count read 1 in the admin dashboard and
    # disarmed the frequency check in checks.py.
    if record.quarantined:
        qdir = ROOT / "data" / "quarantine"
        qdir.mkdir(parents=True, exist_ok=True)
        (qdir / f"{record.run_date}-{record.category}.json").write_text(
            json.dumps(sorted(record.quarantined), indent=2) + "\n", encoding="utf-8"
        )

    return out_path


def all_categories() -> list[str]:
    """Every category the pipeline can run.

    Derived from the question banks rather than a second list, so retiring a
    category is one move (its YAML leaves `questions/`) and cannot leave behind
    a stale entry that quietly bills for a category nobody publishes.
    """
    return sorted(p.stem for p in (ROOT / "questions").glob("*.yml"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one week of Unprompted.")
    parser.add_argument(
        "--category",
        default="all",
        help="category slug, or 'all' for every category in questions/",
    )
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--dry-run", action="store_true", help="do not write files")
    args = parser.parse_args()

    load_local_env()

    categories = all_categories() if args.category == "all" else [args.category]
    if not categories:
        print("no categories to run", file=sys.stderr)
        return 1

    held: dict[str, list[str]] = {}
    total = 0.0

    for category in categories:
        print(f"\nunprompted: {category} for {args.date}", file=sys.stderr)
        try:
            record, reasons = run_category(category, args.date, dry_run=args.dry_run)
        except Exception as exc:  # noqa: BLE001 - one category must not cost the rest
            # Categories are independent measurements that happen to share a
            # scheduler. Letting one crash out of the loop skipped every
            # category after it, and left whatever had already been written
            # sitting uncommitted, because the wrapper script treats an
            # unexpected exit code as "commit nothing".
            #
            # A crash is recorded as a hold: same exit code, so the categories
            # that did publish are still committed, and the reason is in the
            # log beside the ones the checks produced. SystemExit is not caught
            # on purpose, because pre-flight refuses before spending anything
            # and that should stop the whole run.
            print(f"\nFAILED: {category}: {type(exc).__name__}: {exc}", file=sys.stderr)
            traceback.print_exc()
            held[category] = [f"the run raised {type(exc).__name__}: {exc}"]
            continue

        print("\nCOST", file=sys.stderr)
        print(format_report(record.to_dict()), file=sys.stderr)
        total += cost_of_run(record.to_dict())[1]

        if reasons:
            held[category] = reasons
            print(f"\nHELD: {category} will not publish:", file=sys.stderr)
            for reason in reasons:
                print(f"  - {reason}", file=sys.stderr)
        else:
            print(f"\n{category}: all checks passed.", file=sys.stderr)

    if len(categories) > 1:
        print(f"\nWEEK TOTAL ${total:.2f}", file=sys.stderr)

    # One held category must not suppress the others. Everything that passed is
    # in data/runs and will publish; everything held is in data/held and will
    # not. The exit code only decides whether a human is called.
    if held:
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            lines = [f"{c}: {r}" for c, rs in held.items() for r in rs]
            with open(out, "a", encoding="utf-8") as handle:
                handle.write("held=true\n")
                handle.write("reasons<<EOF\n" + "\n".join(lines) + "\nEOF\n")
        return HELD_EXIT_CODE

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
