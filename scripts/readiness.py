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

A late start is handled on purpose: Monday checks need enough time to finish
before 13:00, and never start at or after noon. While a weekly run holds
week.lock, readiness does nothing.

Exit 0 ready or skipped, 2 issues found (an issue is opened unless
--no-issue), 1 the check or the issue could not be completed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
from unprompted.storage import run_lock  # noqa: E402 - stdlib-only module
from unprompted.cli_provider import CLEANUP_WAIT_SECONDS, TREE_KILL_SECONDS, readiness_limit_seconds  # noqa: E402

# Cover every allowed local probe attempt, including version checks and cleanup.
LIMIT_SECONDS = readiness_limit_seconds()
# timed.py may need a tree kill and a slow reap, plus process-start overhead.
WRAPPER_GRACE_SECONDS = TREE_KILL_SECONDS + CLEANUP_WAIT_SECONDS + 60
# Opening the issue afterwards, plus margin. The scheduled task's limit is built
# from this, so Windows can never end the check before it reports (it was a fixed
# 45 minutes while the check itself was allowed about three hours).
NOTIFY_MARGIN_SECONDS = 10 * 60


def task_limit_seconds() -> int:
    """The Task Scheduler ExecutionTimeLimit install-weekly-task.ps1 registers."""
    return LIMIT_SECONDS + WRAPPER_GRACE_SECONDS + NOTIFY_MARGIN_SECONDS


def target_monday(now: datetime) -> date | None:
    """The Monday to check, or None when it is too close to (or past) its start."""
    today = now.date()
    if today.weekday() == 0:
        cutoff = min(now.replace(hour=12, minute=0, second=0, microsecond=0),
                     now.replace(hour=13, minute=0, second=0, microsecond=0)
                     - timedelta(seconds=LIMIT_SECONDS + WRAPPER_GRACE_SECONDS))
        return today if now < cutoff else None
    return today + timedelta(days=7 - today.weekday())


def span(text) -> str:
    """Issue text quotes model names and provider errors: one inline code span."""
    return "`" + " ".join(str(text).replace("`", "").split())[:300] + "`"


def qualify(monday: str, paid: bool = True) -> tuple[dict | None, str]:
    """The preflight JSON, or None and why it could not be had. `paid=False`
    runs the configuration and budget preflight only: no provider is called."""
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(REPO / "src"), os.environ.get("PYTHONPATH")]))}
    # Under timed.py, which ends the whole process tree at the limit, so a hung
    # harness cannot outlive the check.
    argv = [sys.executable, str(REPO / "scripts" / "timed.py"), str(LIMIT_SECONDS),
            sys.executable, "-m", "unprompted.run", "--preflight", *(["--qualify"] if paid else []), "--date", monday]
    try:
        done = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, env=env, timeout=LIMIT_SECONDS + WRAPPER_GRACE_SECONDS)
    except (OSError, subprocess.SubprocessError) as exc:
        return None, f"could not start: {type(exc).__name__}: {exc}"
    try:
        if done.returncode not in (0, 2):
            raise ValueError("check did not complete")
        result = json.loads(done.stdout)
        if (not isinstance(result, dict) or not isinstance(result.get("issues"), list)
                or not all(isinstance(issue, str) for issue in result["issues"])
                or (done.returncode == 2 and not result["issues"])):
            raise ValueError("invalid preflight result")
        # The run's own WARNING lines (for example a probe that searched) are
        # kept: they go to stderr, which a successful check would otherwise drop.
        result["warnings"] = [line.strip() for line in done.stderr.splitlines() if "WARNING" in line]
        return result, ""
    except ValueError:
        why = "timed out" if done.returncode == 124 else f"exit {done.returncode}"
        return None, f"{why}: {done.stderr.strip()[-300:]}"


# How stale each job's last success may be before someone is told. Daily jobs
# get two days, so one missed day (PC off) is not an alarm but two are.
STALE_HOURS = {"sync_vault": 50, "sync_analytics": 50, "backup": 50}
MIN_FREE_GIB = 10


def house_checks() -> list[str]:
    """Everything outside the providers that a Monday needs. Free: no provider calls.

    Each one is a way a week was, or could be, lost without any engine failing:
    an expired GitHub sign-in (no push, no issues), a nearly full disk, a backup
    or analytics export that quietly stopped, a week still waiting to be pushed,
    an alert nobody received, or the off-host watchdog disabled by GitHub.
    """
    issues = []

    def run(argv: list[str], timeout: int = 120) -> subprocess.CompletedProcess | None:
        try:
            return subprocess.run(argv, cwd=REPO, capture_output=True, text=True, timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            return None

    auth = run(["gh", "auth", "status"], 60)
    if auth is None or auth.returncode != 0:
        issues.append("GitHub CLI is not signed in (gh auth status failed): alerts and publication need it")
    push = run(["git", "push", "--dry-run", "origin", "HEAD:main"])
    if push is None or push.returncode != 0:
        issues.append("git push --dry-run origin HEAD:main failed: the week could be measured but not published")
    free = shutil.disk_usage(REPO).free / 2**30
    if free < MIN_FREE_GIB:
        issues.append(f"only {free:.1f} GiB free on the checkout's drive (new paid work stops below 5)")
    now = datetime.now(timezone.utc)
    for name, hours in STALE_HOURS.items():
        status: dict = {}
        try:
            status = json.loads((REPO / ".unprompted" / "status" / f"{name}.json").read_text(encoding="utf-8"))
            last = datetime.strptime(status["last_success"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            error = status.get("error") if isinstance(status, dict) else None
            issues.append(f"{name} has never recorded a success" + (f" (last error: {error})" if error else ""))
            continue
        if now - last > timedelta(hours=hours):
            issues.append(f"{name} last succeeded {last:%Y-%m-%d %H:%M} UTC; last error: {status.get('error') or 'none recorded'}")
    try:
        intent = json.loads((REPO / ".unprompted" / "publish-intent.json").read_text(encoding="utf-8"))
        if intent.get("state") == "committed":
            issues.append(f"measured week {str(intent.get('commit'))[:12]} is committed but not pushed yet")
    except (OSError, ValueError, AttributeError):
        pass
    try:
        alert = json.loads((REPO / ".unprompted" / "status" / "alert.json").read_text(encoding="utf-8"))
        if alert.get("ok") is False:
            issues.append(f"the last {alert.get('alert_status', '')} alert could not be delivered as a GitHub issue")
    except (OSError, ValueError, AttributeError):
        pass
    state = run(["gh", "api", "repos/{owner}/{repo}/actions/workflows/watchdog.yml", "--jq", ".state"], 60)
    if state is None or state.returncode != 0 or state.stdout.strip() != "active":
        issues.append("the GitHub watchdog workflow is not active (GitHub disables schedules after 60 quiet days); "
                      "re-enable it in the Actions tab")
    return issues


def open_issue(monday: str, issues: list[str], warnings: list[str] = (), kind: str = "Monday readiness") -> bool:
    """One issue per Monday and kind, found again by its exact title. False if GitHub failed."""
    title = f"{kind}: problems before {monday}"
    body = "\n".join([
        f"The checks the weekly run makes first were run ahead of **{monday}** and found:", "",
        *[f"- {span(i)}" for i in issues], "",
        *(["Also noted:", "", *[f"- {span(w)}" for w in warnings], ""] if warnings else []),
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
    parser.add_argument("--print-task-limit", action="store_true", help="print the scheduled task's time limit in seconds and exit")
    parser.add_argument("--free", action="store_true", help="mid-week check: configuration, budget and house checks only, no provider calls")
    args = parser.parse_args()
    if args.print_task_limit:
        print(task_limit_seconds())
        return 0
    monday = target_monday(datetime.now())
    if monday is None:
        print("Monday's run is due or under way; not checking now.")
        return 0
    # Held for the whole check, so no measurement can start inside it. A weekly
    # run that arrives meanwhile waits longer than this check and wrapper grace.
    # The computed Monday cut-off leaves both finished before the scheduled start.
    try:
        with run_lock(REPO / ".unprompted", "week.lock"):
            result, failure = qualify(monday.isoformat(), paid=not args.free)
    except OSError:
        print("a weekly run is in progress; not checking now.")
        return 0
    issues = (result or {}).get("issues") or ([f"the readiness check itself failed ({failure})"] if result is None else [])
    issues = [*issues, *house_checks()]
    warnings = (result or {}).get("warnings") or []
    print(json.dumps({"monday": monday.isoformat(), "issues": issues, "warnings": warnings,
                      "engines": (result or {}).get("engines_identified", {})}, indent=2))
    if not issues:
        return 0
    kind = "Mid-week check" if args.free else "Monday readiness"
    if not args.no_issue and not open_issue(monday.isoformat(), issues, warnings, kind):
        return 1
    return 2 if result is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
