"""Commit and push a measured week, and finish a push that an earlier run could not.

    python scripts/publish.py final --message "Run: ..."   # the launcher, after measuring
    python scripts/publish.py pending                       # launcher start, and the daily sync

Before this existed the commit and push lived in weekly-run.cmd. A push that failed
on a network blip left the week on this machine only, and the next Monday refused
to start over the leftover state until somebody pushed by hand.

The commit SHA is the manifest: Git already hashes every path and blob in it. Right
after committing, `.unprompted/publish-intent.json` records that SHA. Recovery only
ever pushes that exact commit, fast-forward, never forced, and only while local main
still points at it; anything else (diverged remote, extra local commits, a moved
HEAD) is reported for a person and left alone. A commit that failed, or a crash
between commit and intent, is also left for a person: dirty or unclaimed output is
never adopted automatically.

Exit 0 published (or nothing to do), 3 not published (reason on stderr), 4 busy.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
sys.path.insert(0, str(REPO / "scripts"))
from unprompted.storage import record_status, run_lock, write_json  # noqa: E402

STATE = REPO / ".unprompted"
INTENT = STATE / "publish-intent.json"
BOT = ["-c", "user.name=unprompted-bot", "-c", "user.email=bot@unprompted.report"]
SHA = re.compile(r"^[0-9a-f]{40}$")
# One deadline for the whole publication, so retries can never run into the
# scheduler's 8-hour kill: three attempts, 30 s and 120 s apart, 300 s each.
ATTEMPT_SECONDS = 300
BACKOFF = (30, 120)
DEADLINE_SECONDS = 20 * 60


def git(*args: str, timeout: float = 120) -> subprocess.CompletedProcess:
    # Timed out git is killed by subprocess.run; network helpers are bounded by
    # git's own low-speed limit below.
    return subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, timeout=timeout)


def out(*args: str) -> str:
    done = git(*args)
    if done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {done.stderr.strip()[:300]}")
    return done.stdout.strip()


def contains(ancestor: str, descendant: str) -> bool:
    return git("merge-base", "--is-ancestor", ancestor, descendant).returncode == 0


def read_intent() -> dict | None:
    try:
        intent = json.loads(INTENT.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"publish intent is unreadable: {exc}") from exc
    if not (isinstance(intent, dict) and intent.get("state") in {"committed", "pushed"}
            and all(isinstance(intent.get(k), str) and SHA.match(intent[k]) for k in ("commit", "parent"))):
        raise RuntimeError("publish intent is malformed; inspect .unprompted/publish-intent.json")
    return intent


def push(commit: str, started: float) -> str:
    """Fast-forward origin/main to `commit`; "" on success, else why not."""
    why = "no attempt fitted the deadline"
    for attempt in range(1 + len(BACKOFF)):
        if time.monotonic() - started + ATTEMPT_SECONDS > DEADLINE_SECONDS:
            break
        try:
            done = git("-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=120",
                       "push", "origin", f"{commit}:refs/heads/main", timeout=ATTEMPT_SECONDS)
            why = done.stderr.strip()[-300:] if done.returncode else ""
        except subprocess.TimeoutExpired:
            why = f"push timed out after {ATTEMPT_SECONDS}s"
        if not why:
            # Confirm the remote really has it, not just that push said so.
            fetched = git("fetch", "origin", "main", timeout=ATTEMPT_SECONDS)
            if fetched.returncode == 0 and contains(commit, "origin/main"):
                return ""
            why = "push reported success but origin/main does not contain the commit"
        if attempt < len(BACKOFF):
            print(f"push attempt {attempt + 1} failed: {why}; retrying", file=sys.stderr)
            time.sleep(BACKOFF[attempt])
    return why


def finish_pending(started: float | None = None) -> tuple[int, str]:
    started = time.monotonic() if started is None else started
    intent = read_intent()
    if intent is None or intent["state"] == "pushed":
        return 0, "nothing pending"
    commit = intent["commit"]
    fetched = git("fetch", "origin", "main", timeout=ATTEMPT_SECONDS)
    if fetched.returncode != 0:
        return 3, f"could not fetch origin: {fetched.stderr.strip()[-300:]}"
    if contains(commit, "origin/main"):
        # The push landed and only its acknowledgement was lost.
        write_json(INTENT, {**intent, "state": "pushed"}, replace=True)
        return 0, f"{commit[:12]} was already on origin"
    if out("rev-parse", "main") != commit:
        return 3, (f"local main moved away from the unpushed week {commit[:12]}; "
                   "inspect `git log origin/main..main` and push or reconcile by hand")
    if not contains("origin/main", commit):
        return 3, (f"origin/main has diverged from the unpushed week {commit[:12]}; "
                   "reconcile by hand (never force-push the archive)")
    why = push(commit, started)
    if why:
        return 3, f"pushing {commit[:12]} failed: {why}"
    write_json(INTENT, {**intent, "state": "pushed"}, replace=True)
    return 0, f"pushed {commit[:12]}"


def final(message: str, started: float | None = None) -> tuple[int, str]:
    started = time.monotonic() if started is None else started
    code, why = finish_pending(started)
    if code:
        return code, f"an earlier week is still unpublished: {why}"
    if out("branch", "--show-current") != "main":
        return 3, "the checkout left main during the run; nothing committed"
    # A commit that no intent claims (a crash between commit and intent, or a
    # hand commit) would otherwise ride along with this week's push.
    unclaimed = out("rev-list", "origin/main..HEAD")
    if unclaimed:
        return 3, (f"local main has {len(unclaimed.split())} commit(s) not on origin that no run recorded; "
                   "inspect `git log origin/main..main` before publishing. Nothing committed.")
    added = git("add", "data", "reports")
    if added.returncode != 0:
        return 3, f"git add failed, the week is on this machine only: {added.stderr.strip()[-300:]}"
    if git("diff", "--staged", "--quiet").returncode == 0:
        return 0, "no new data to commit"
    parent = out("rev-parse", "HEAD")
    done = git(*BOT, "commit", "-m", message)
    if done.returncode != 0:
        return 3, f"git commit failed, the week is measured but not committed: {done.stderr.strip()[-300:]}"
    commit = out("rev-parse", "HEAD")
    write_json(INTENT, {"schema": 1, "commit": commit, "parent": parent, "message": message,
                        "state": "committed", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
               replace=True)
    why = push(commit, started)
    if why:
        return 3, (f"committed {commit[:12]} but the push failed ({why}); it stays recorded and the next "
                   "start or daily sync pushes it. Do not re-run the week.")
    write_json(INTENT, {**read_intent(), "state": "pushed"}, replace=True)
    return 0, f"PUSHED {commit}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("mode", choices=["final", "pending"])
    parser.add_argument("--message", default="Run: measured and published")
    parser.add_argument("--wait", type=float, default=0, help="seconds to wait for a busy week.lock")
    args = parser.parse_args()
    started = time.monotonic()
    try:
        # week.lock then run.lock, the order every job takes them in. The run has
        # released both by the time the launcher publishes.
        with run_lock(STATE, "week.lock", wait=args.wait), run_lock(STATE, "run.lock", wait=args.wait):
            try:
                code, why = final(args.message, started) if args.mode == "final" else finish_pending(started)
            except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
                code, why = 3, str(exc)
    except OSError:
        print("a weekly run or another job holds the lock; publication not attempted now", file=sys.stderr)
        return 4
    print(why, file=sys.stderr if code else sys.stdout)
    record_status(STATE / "status", "publish", code == 0, "" if code == 0 else why, mode=args.mode)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
