"""Did Monday happen at all?

Every other alarm in this repo runs inside the weekly job, which means every one
of them is silent in the single case that matters most: the job never started,
or died before it could speak. On 2026-08-24 the scheduled task was terminated
mid-run. Windows recorded exit 0x41306. `data/last-run.json` still said "No run
has reported yet" two days later, the site kept showing the previous Monday's
date -- which is exactly what it shows on a healthy week -- and nothing
anywhere said a word.

So this runs somewhere else. GitHub's cron does not care whether the laptop is
awake, plugged in, or has been carried to another country, and that
independence is the entire point: a watchdog that shares a failure domain with
the thing it watches is decoration.

It asks one question -- is this week's run in the repository -- and answers it
from the archive rather than from any status file the run itself had to survive
long enough to write.

    python scripts/watchdog.py                # report, exit 1 if a week is missing
    python scripts/watchdog.py --issue        # also open a GitHub issue
    python scripts/watchdog.py --date 2026-08-24
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
QUESTIONS = REPO / "questions"
RUNS = REPO / "data" / "runs"
HELD = REPO / "data" / "held"
STATUS_FILE = REPO / "data" / "last-run.json"

# How long after Monday 13:00 America/New_York a missing run counts as missing
# rather than as still in progress. A full week takes tens of minutes; this is
# generous enough that a slow run is never reported as a dead one.
#
# Four, not six: the cutoff below is 18:00 UTC plus this, and six would put it
# at midnight, where "before the deadline" is true for every hour of Monday and
# a Monday-evening check would silently report the *previous* week as missing.
GRACE_HOURS = 4


def live_categories() -> list[str]:
    """What the pipeline would run, from the same files it reads.

    The question bank is the declaration of what gets measured, so a category
    added there is watched from the moment it exists -- without anybody
    remembering to add it here too.
    """
    if not QUESTIONS.exists():
        return []
    return sorted(p.stem for p in QUESTIONS.glob("*.yml"))


def most_recent_monday(today: date) -> date:
    """The Monday whose run should exist by now.

    Today's Monday counts only once the grace period has passed; before that a
    run in progress is not a missing one. Any other day looks back to the last
    Monday, so a Wednesday check still catches a Monday that never happened.
    """
    monday = today - timedelta(days=today.weekday())
    if today.weekday() == 0:
        now = datetime.now(timezone.utc)
        # Monday 13:00 New York is 17:00 UTC in summer, 18:00 in winter. Using
        # the later of the two plus the grace period keeps this correct all
        # year without a timezone dependency: being an hour cautious can only
        # delay an alarm, never raise a false one.
        if now.hour < 18 + GRACE_HOURS:
            monday -= timedelta(days=7)
    return monday


def ever_measured(category: str) -> bool:
    """Has this category ever produced a run, published or held?

    A category added to the question bank on a Tuesday has not missed anything;
    it has not started. Alarming about it would be a false alarm on the day of
    a perfectly ordinary edit, and false alarms are how an alarm gets muted --
    which costs far more than the one it was raised about.
    """
    return any(
        (base / day.name / f"{category}.json").exists()
        for base in (RUNS, HELD)
        if base.exists()
        for day in base.iterdir()
        if day.is_dir()
    )


def week_status(monday: date) -> tuple[list[str], list[str], list[str]]:
    """(produced this week, missing this week, never measured at all).

    A held run counts as produced. Held is the checks working: it was measured,
    it was written down, and the run said so on its way out. This watches for
    silence, not for failure -- failure already has a voice.
    """
    day = monday.isoformat()
    produced, missing, unstarted = [], [], []
    for category in live_categories():
        if (RUNS / day / f"{category}.json").exists() or (
            HELD / day / f"{category}.json"
        ).exists():
            produced.append(category)
        elif ever_measured(category):
            missing.append(category)
        else:
            unstarted.append(category)
    return produced, missing, unstarted


def last_reported() -> dict:
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def open_issue(title: str, body: str) -> None:
    """Reach a phone. Never raises: a broken alarm must not break the check."""
    try:
        existing = subprocess.run(
            ["gh", "issue", "list", "--state", "open", "--search", title, "--json", "title"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if title in (existing.stdout or ""):
            print(f"  an open issue already says this: {title}", file=sys.stderr)
            return
        subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body,
             "--label", "weekly-run"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        print(f"  opened: {title}", file=sys.stderr)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"  could not open an issue: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Did this week's run happen?")
    parser.add_argument("--date", help="pretend today is this date (YYYY-MM-DD)")
    parser.add_argument(
        "--issue", action="store_true", help="open a GitHub issue when a week is missing"
    )
    args = parser.parse_args()

    today = date.fromisoformat(args.date) if args.date else date.today()
    monday = most_recent_monday(today)
    produced, missing, unstarted = week_status(monday)

    print(f"week of {monday}", file=sys.stderr)
    print(f"  produced : {', '.join(produced) or 'nothing'}", file=sys.stderr)
    print(f"  missing  : {', '.join(missing) or 'nothing'}", file=sys.stderr)
    if unstarted:
        # Named, not counted. A category in the bank that has never produced a
        # run is usually one added since the last Monday, and treating that as a
        # missed week would fire an alarm on an ordinary edit.
        print(
            f"  not yet  : {', '.join(unstarted)} (never measured, not counted)",
            file=sys.stderr,
        )

    status = last_reported()
    if status:
        print(
            f"  last-run : {status.get('status')} at {status.get('at')}",
            file=sys.stderr,
        )

    if not missing:
        print("the week is in the archive.", file=sys.stderr)
        return 0

    # Everything missing and nothing produced reads differently from a partial
    # week, and leads somewhere different: one is "the machine never ran", the
    # other is "one category died". Say which.
    whole_week = not produced
    title = (
        f"Weekly run did not happen: {monday}"
        if whole_week
        else f"Weekly run incomplete: {monday}"
    )
    body = "\n".join(
        [
            f"No run for **{monday}** is in the repository for: "
            + ", ".join(f"`{c}`" for c in missing),
            "",
            f"Produced: {', '.join(f'`{c}`' for c in produced) or '_nothing_'}",
            "",
            f"`data/last-run.json` says: **{status.get('status', 'nothing at all')}**"
            + (f" at {status['at']}" if status.get("at") else ""),
            "",
            "This check runs on GitHub rather than on the measuring machine, so",
            "it is the one alarm that still fires when that machine is asleep,",
            "off, or was killed mid-run. It looks at the archive itself, not at",
            "a status file the run had to survive long enough to write.",
            "",
            "Worth checking, in order:",
            "",
            "1. Windows Task Scheduler, task **Unprompted weekly run** — its",
            "   last result. `0x41306` means it was terminated.",
            "2. Whether the machine was awake at 13:00 Monday. `WakeToRun` is",
            "   off, so a sleeping machine defers the run silently.",
            "3. The run log, and `data/last-run.json`.",
            "",
            "A held run does **not** trigger this: held is the checks working,",
            "and it reports itself. This fires only on silence.",
        ]
    )

    print(f"\n{title}", file=sys.stderr)
    if args.issue:
        open_issue(title, body)
    else:
        print(body, file=sys.stderr)

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
