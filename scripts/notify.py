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
from unprompted.storage import record_status, write_json

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


def write_status(status: str, detail: str, exit_code: int, summary: dict | None = None) -> None:
    """The durable half. Committed with the run, so the record is in git.

    `categories` (from the run's summary) gives each category's outcome --
    passed, held, failed, not_started or not_run -- with its reasons, so a
    reader or an agent need not parse `detail`.
    """
    destination = REPO / ".unprompted" / "last-attempt.json" if status == "failed" else STATUS_FILE
    write_json(destination,
            {
                "status": "measured" if status == "published" else status,
                "detail": detail,
                "exit_code": exit_code,
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                **{k: summary[k] for k in ("run_date", "categories") if summary and k in summary},
            }, replace=True,
    )
    print(f"  wrote {destination.relative_to(REPO)}", file=sys.stderr)


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


DECISION = "need a decision: "


def alias_steps(summary: dict | None) -> list[str]:
    """What to do for each category held on unrecognised names: the file, and the free command.

    The decision itself stays a person's (aliases are the owner's); this only
    removes the guesswork afterwards. The free re-read needs every answer's raw
    names stored (readings from November 2026 on); otherwise only a paid re-read
    can apply new aliases, and that is said instead of a command.
    """
    run_date = (summary or {}).get("run_date")
    lines = []
    for category, row in sorted(((summary or {}).get("categories") or {}).items()):
        reasons = [r for r in (row or {}).get("reasons") or [] if isinstance(r, str)]
        names = [r.split(DECISION, 1)[1] for r in reasons if DECISION in r]
        if not names or not run_date:
            continue
        held = REPO / "data" / "held" / run_date / f"{category}.json"
        try:
            records = json.loads(held.read_text(encoding="utf-8"))["extractions"]
            stored = bool(records) and all(e.get("extracted") is not None for e in records)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            stored = False
        others = [r for r in reasons if DECISION not in r]
        lines += [f"**{category}**: decide {names[0]}",
                  f"1. Add each name to `aliases/{category}.yml` (an alias of an existing brand, a new brand, "
                  "or `exclude`), commit and push."]
        if stored:
            lines.append(f"2. From the day after {run_date}, re-read for free: "
                         f"`python -m unprompted.reextract {run_date} --category {category} --renormalize`, "
                         "then commit and push the new reading. It keeps the original measurement date and "
                         "reruns every check.")
        else:
            lines.append("2. This reading did not store raw names, so applying the new aliases to it needs a "
                         "paid re-read; otherwise the next weekly run uses them.")
        if others:
            lines.append(f"   Also held for: {'; '.join(others)[:300]} (a re-read does not fix that).")
        lines.append("")
    return lines


def open_issue(status: str, detail: str, exit_code: int, summary: dict | None = None) -> bool:
    """The half that reaches a phone. True once an issue for this exists."""
    day = datetime.now(timezone.utc).date().isoformat()
    title = f"Weekly run {HEADLINE.get(status, status)}: {day}"

    if existing_issue(title):
        print(f"  issue already open: {title}", file=sys.stderr)
        return True

    body = "\n".join(
        [
            f"The run on {day} finished with status **{status}** (exit {exit_code}).",
            "",
            "```",
            detail.strip() or "(no detail recorded)",
            "```",
            "",
            *(["What to do about the unrecognised names:", "", *steps] if (steps := alias_steps(summary)) else []),
            "The log is at `.unprompted\\logs\\weekly.log` in the checkout on the machine that runs it.",
            "",
            "Categories can have different outcomes. Passed readings are in `data/runs/`;",
            "held readings are in `data/held/`. A failed or refused category may have",
            "only local checkpoints, or no new answers. A passed check does not prove deployment.",
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
            return True
        print(f"  could not open an issue: {made.stderr.strip()}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"  could not open an issue: {exc}", file=sys.stderr)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", required=True, choices=sorted(HEADLINE))
    parser.add_argument("--detail", default="")
    parser.add_argument("--summary-file", type=Path, help="use the completed pipeline's category summary")
    parser.add_argument("--exit-code", type=int, default=0)
    parser.add_argument(
        "--no-issue",
        action="store_true",
        help="write the status file but do not open an issue",
    )
    args = parser.parse_args()

    summary = None
    if args.summary_file:
        try:
            summary = json.loads(args.summary_file.read_text(encoding="utf-8"))
            if not isinstance(summary.get("detail"), str) or not summary["detail"].strip():
                raise ValueError("summary detail is missing")
            args.detail = summary["detail"]
        except (OSError, ValueError, AttributeError) as exc:
            args.detail += f" Category summary unavailable: {exc}"

    # Everything below is best effort. This script exists to report a problem,
    # and it must never become one.
    try:
        write_status(args.status, args.detail, args.exit_code, summary)
    except Exception as exc:  # noqa: BLE001
        print(f"  could not write the status file: {exc}", file=sys.stderr)

    if args.status in NEEDS_A_HUMAN and not args.no_issue:
        delivered = open_issue(args.status, args.detail, args.exit_code, summary)
        # An alert nobody received is itself a failure, recorded where the
        # mid-week check and the heartbeat read it. Exit 3 tells the launcher;
        # the launcher never lets it stop publication.
        record_status(REPO / ".unprompted" / "status", "alert", delivered,
                      "" if delivered else "the GitHub issue could not be opened", alert_status=args.status)
        if not delivered:
            return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
