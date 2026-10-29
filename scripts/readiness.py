"""Sunday's check on Monday: run the weekly run's first steps and open an issue if they fail.

    python scripts/readiness.py            # the coming Monday
    python scripts/readiness.py --no-issue # print only

Runs `unprompted.run --preflight --qualify` for the coming Monday: the local
engines' isolation canaries, the model every engine reports, the method-change
comparison, configuration and budget. Real but small calls: two per local
harness on the subscription and Gemini's model probe (up to three tiny
attempts); nothing is measured. On 2026-10-26 a Codex CLI update changed its
default model and the run refused on the day; this finds that the evening
before. Scheduled by scripts/install-weekly-task.ps1 (Sundays 18:00).

A late start is handled on purpose: on a Monday before noon it checks that
day's run; from noon on Monday, or while a weekly run holds week.lock, it does
nothing, so it never overlaps a measurement.

Exit 0 ready or skipped, 2 issues found (an issue is opened unless
--no-issue), 1 the check or the issue could not be completed.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
from unprompted.storage import run_lock  # noqa: E402 - stdlib-only module

LIMIT_SECONDS = 1800


def target_monday(now: datetime) -> date | None:
    """The Monday to check, or None when it is too close to (or past) its start."""
    today = now.date()
    if today.weekday() == 0:
        return today if now.hour < 12 else None
    return today + timedelta(days=7 - today.weekday())


def span(text) -> str:
    """Issue text quotes model names and provider errors: one inline code span."""
    return "`" + " ".join(str(text).replace("`", "").split())[:300] + "`"


def qualify(monday: str) -> tuple[dict | None, str]:
    """The preflight JSON, or None and why it could not be had."""
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(REPO / "src"), os.environ.get("PYTHONPATH")]))}
    # Under timed.py, which ends the whole process tree at the limit, so a hung
    # harness cannot outlive the check.
    argv = [sys.executable, str(REPO / "scripts" / "timed.py"), str(LIMIT_SECONDS),
            sys.executable, "-m", "unprompted.run", "--preflight", "--qualify", "--date", monday]
    try:
        done = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, env=env, timeout=LIMIT_SECONDS + 120)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, f"could not start: {type(exc).__name__}: {exc}"
    try:
        return json.loads(done.stdout), ""
    except ValueError:
        why = "timed out" if done.returncode == 124 else f"exit {done.returncode}"
        return None, f"{why}: {done.stderr.strip()[-300:]}"


def open_issue(monday: str, issues: list[str]) -> bool:
    """One issue per Monday, found again by its exact title. False if GitHub failed."""
    title = f"Monday readiness: problems before {monday}"
    body = "\n".join([
        f"The checks the weekly run makes first were run ahead of **{monday}** and found:", "",
        *[f"- {span(i)}" for i in issues], "",
        "Fix these before 13:00 Monday, or the run will refuse or hold. Re-check with",
        "`python -m unprompted.run --preflight --qualify`.", "",
        "_Opened by `scripts/readiness.py`._",
    ])
    try:
        found = subprocess.run(["gh", "issue", "list", "--state", "open", "--search", title, "--json", "title"],
                               cwd=REPO, capture_output=True, text=True, timeout=60)
        if found.returncode != 0:
            print(f"could not look for an existing issue: {found.stderr.strip()}", file=sys.stderr)
            return False
        if any(i.get("title") == title for i in json.loads(found.stdout or "[]")):
            print(f"issue already open: {title}", file=sys.stderr)
            return True
        made = subprocess.run(["gh", "issue", "create", "--title", title, "--body", body],
                              cwd=REPO, capture_output=True, text=True, timeout=60)
        if made.returncode != 0:
            print(f"could not open an issue: {made.stderr.strip()}", file=sys.stderr)
            return False
        return True
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"could not open an issue: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-issue", action="store_true", help="print the result without opening an issue")
    args = parser.parse_args()
    monday = target_monday(datetime.now())
    if monday is None:
        print("Monday's run is due or under way; not checking now.")
        return 0
    try:
        with run_lock(REPO / ".unprompted", "week.lock"):
            pass  # released at once: holding it would make Monday's run wait on this
    except OSError:
        print("a weekly run is in progress; not checking now.")
        return 0
    result, failure = qualify(monday.isoformat())
    issues = (result or {}).get("issues") or ([f"the readiness check itself failed ({failure})"] if result is None else [])
    print(json.dumps({"monday": monday.isoformat(), "issues": issues,
                      "engines": (result or {}).get("engines_identified", {})}, indent=2))
    if not issues:
        return 0
    if not args.no_issue and not open_issue(monday.isoformat(), issues):
        return 1
    return 2 if result is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
