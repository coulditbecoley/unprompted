"""Tell GitHub the weekly run is alive: `heartbeat.py started` / `heartbeat.py finished --exit-code N`.

The watchdog runs on GitHub, so it is the one alarm that still works when this
machine is off. But it could only see the archive, which is written at the end,
so it could not tell "never started" from "still running" until Tuesday. This
writes a small JSON value into the repository variable UNPROMPTED_HEARTBEAT at
the start and at every exit; watchdog.py --mode start|finish reads it on Monday
afternoon and evening.

Nothing private goes in it (no answers, keys or paths), and it can never stop
the run: every failure is printed and the exit code is always 0.
"""

from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATE = REPO / ".unprompted"
RUN_ID = STATE / "heartbeat-run-id"
VARIABLE = "UNPROMPTED_HEARTBEAT"


def this_monday(today: date) -> str:
    return (today - timedelta(days=today.weekday())).isoformat()


def status_ok(name: str) -> bool | None:
    try:
        return bool(json.loads((STATE / "status" / f"{name}.json").read_text(encoding="utf-8")).get("ok"))
    except (OSError, ValueError, AttributeError):
        return None


def payload(phase: str, exit_code: int | None, today: date) -> dict:
    if phase == "started":
        run_id = secrets.token_hex(6)
        try:
            RUN_ID.parent.mkdir(parents=True, exist_ok=True)
            RUN_ID.write_text(run_id, encoding="utf-8")
        except OSError:
            pass
    else:
        try:
            run_id = RUN_ID.read_text(encoding="utf-8").strip()[:32]
        except OSError:
            run_id = "unknown"
    body = {"schema": 1, "week": this_monday(today), "phase": phase, "run_id": run_id,
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    if phase == "finished":
        body.update(exit_code=exit_code, published=status_ok("publish"), backup=status_ok("backup"))
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("phase", choices=["started", "finished"])
    parser.add_argument("--exit-code", type=int)
    args = parser.parse_args()
    body = json.dumps(payload(args.phase, args.exit_code, date.today()), separators=(",", ":"))
    try:
        done = subprocess.run(["gh", "variable", "set", VARIABLE, "--body", body],
                              cwd=REPO, capture_output=True, text=True, timeout=60)
        if done.returncode:
            print(f"heartbeat not sent: {done.stderr.strip()[:200]}", file=sys.stderr)
        else:
            print(f"heartbeat {args.phase}: {body}")
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"heartbeat not sent: {type(exc).__name__}: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
