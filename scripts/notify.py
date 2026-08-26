"""Say what the weekly run did, loudly enough to be noticed.

The run happens on one machine, on a schedule, and writes to a log file nobody
opens. A week that is held, that crashes, or that measures everything and then
fails to push looks exactly like a week that went fine: the site keeps showing
last Monday's date, which is what it would show anyway. For a publication whose
value is an unbroken series, a missed week that nobody notices is the one
failure that cannot be repaired later.

Two channels, because they fail differently:

    data/last-run.json   committed with the run, so the operator dashboard can
                         show it and git history keeps every outcome. Survives
                         a machine being off; needs somebody to look.
    a GitHub issue       reaches a phone. Only for outcomes that need a human,
                         and de-duplicated, so a re-run on the same day does not
                         open a second one.

Never fails the run. A notification that breaks the thing it reports on is
worse than no notification.

    python scripts/notify.py --status held --detail "2 categories held"
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATUS_FILE = REPO / "data" / "last-run.json"

# Which outcomes are worth interrupting somebody for. A clean publication is
# not: the site itself is the notification, and a weekly mail nobody needs
# teaches them to filter the ones they do.
NEEDS_A_HUMAN = {"held", "failed"}

HEADLINE = {
    "published": "published",
    "held": "held for review",
    "failed": "FAILED",
}


def write_status(status: str, detail: str, exit_code: int) -> None:
    """The durable half. Committed with the run, so the record is in git."""
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(
        json.dumps(
            {
                "status": status,
                "detail": detail,
                "exit_code": exit_code,
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"  wrote {STATUS_FILE.relative_to(REPO)}", file=sys.stderr)


def existing_issue(title: str) -> bool:
    """Is one already open for this? Re-running a bad Monday is normal."""
    try:
        found = subprocess.run(
            ["gh", "issue", "list", "--state", "open", "--search", title, "--json", "title"],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if found.returncode != 0:
            return False
        return any(row.get("title") == title for row in json.loads(found.stdout or "[]"))
    except Exception:  # noqa: BLE001 - a failed check must not block the notice
        return False


def open_issue(status: str, detail: str, exit_code: int) -> None:
    """The half that reaches a phone."""
    day = datetime.now(timezone.utc).date().isoformat()
    title = f"Weekly run {HEADLINE.get(status, status)}: {day}"

    if existing_issue(title):
        print(f"  issue already open: {title}", file=sys.stderr)
        return

    body = "\n".join(
        [
            f"The run on {day} finished with status **{status}** (exit {exit_code}).",
            "",
            "```",
            detail.strip() or "(no detail recorded)",
            "```",
            "",
            "The log is at `%TEMP%\\unprompted-weekly.log` on the machine that runs it.",
            "",
            "A held week is the checks working: the data is in `data/held/` and",
            "nothing was published. Re-read stored answers without re-querying the",
            "engines with `python -m unprompted.reextract <date> --category <slug>`.",
            "",
            "_Opened by `scripts/notify.py`._",
        ]
    )

    try:
        made = subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body],
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if made.returncode == 0:
            print(f"  opened {made.stdout.strip()}", file=sys.stderr)
        else:
            print(f"  could not open an issue: {made.stderr.strip()}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"  could not open an issue: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", required=True, choices=sorted(HEADLINE))
    parser.add_argument("--detail", default="")
    parser.add_argument("--exit-code", type=int, default=0)
    parser.add_argument(
        "--no-issue",
        action="store_true",
        help="write the status file but do not open an issue",
    )
    args = parser.parse_args()

    # Everything below is best effort. This script exists to report a problem,
    # and it must never become one.
    try:
        write_status(args.status, args.detail, args.exit_code)
    except Exception as exc:  # noqa: BLE001
        print(f"  could not write the status file: {exc}", file=sys.stderr)

    if args.status in NEEDS_A_HUMAN and not args.no_issue:
        open_issue(args.status, args.detail, args.exit_code)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
