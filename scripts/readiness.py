"""Sunday's check on Monday: run the weekly run's first steps and open an issue if they fail.

    python scripts/readiness.py            # next Monday
    python scripts/readiness.py --no-issue # print only

Runs `unprompted.run --preflight --qualify` for the coming Monday: the local
engines' isolation canaries, the model every engine reports, the method-change
comparison, configuration and budget. A few subscription calls and one tiny
Gemini call; nothing is measured. On 2026-10-26 a Codex CLI update changed its
default model and the run refused on the day; this finds that the evening
before. Scheduled by scripts/install-weekly-task.ps1 (Sundays 18:00).

Exit 0 ready, 2 issues found (an issue is opened unless --no-issue), 1 could
not check at all.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def next_monday(today: date) -> date:
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def span(text) -> str:
    """Issue text quotes model names and provider errors: one inline code span."""
    return "`" + " ".join(str(text).replace("`", "").split())[:300] + "`"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-issue", action="store_true", help="print the result without opening an issue")
    args = parser.parse_args()
    monday = next_monday(date.today()).isoformat()
    # This checkout's own code, whatever the interpreter has installed.
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(REPO / "src"), os.environ.get("PYTHONPATH")]))}
    done = subprocess.run([sys.executable, "-m", "unprompted.run", "--preflight", "--qualify", "--date", monday],
                          cwd=REPO, capture_output=True, text=True, timeout=1800, env=env)
    checked = True
    try:
        result = json.loads(done.stdout)
    except ValueError:
        checked = False
        print(f"readiness could not run (exit {done.returncode}):\n{done.stderr[-2000:]}", file=sys.stderr)
        result = {"issues": [f"the readiness check itself failed (exit {done.returncode}): {done.stderr.strip()[-300:]}"]}
    issues = result.get("issues") or []
    print(json.dumps({"monday": monday, "issues": issues, "engines": result.get("engines_identified", {})}, indent=2))
    if not issues:
        return 0
    if not args.no_issue:
        title = f"Monday readiness: {len(issues)} issue(s) before {monday}"
        body = "\n".join([
            f"The checks the weekly run makes first were run the evening before **{monday}** and found:", "",
            *[f"- {span(i)}" for i in issues], "",
            "Fix these before 13:00 Monday, or the run will refuse or hold. Re-check with",
            "`python -m unprompted.run --preflight --qualify`.", "",
            "_Opened by `scripts/readiness.py`._",
        ])
        try:
            open_ = subprocess.run(["gh", "issue", "list", "--state", "open", "--search", title, "--json", "title"],
                                   cwd=REPO, capture_output=True, text=True, timeout=60)
            if title not in open_.stdout:
                subprocess.run(["gh", "issue", "create", "--title", title, "--body", body],
                               cwd=REPO, capture_output=True, text=True, timeout=60)
        except Exception as exc:  # noqa: BLE001 - the printed result above is still the record
            print(f"could not open an issue: {exc}", file=sys.stderr)
    return 2 if checked else 1


if __name__ == "__main__":
    raise SystemExit(main())
