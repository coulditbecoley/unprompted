"""Draft the weekly newsletter issue from published runs. Never sends anything.

    python -m unprompted.newsletter --week 2026-11-02

Writes private/newsletter/<week>.md for Loki to edit and Coley to paste into
Buttondown. A category appears only if a measurement in the issue week was
published; a headline needs a comparable earlier measurement *and* movement
beyond noise. Anything else is said plainly, never padded into a story.
Movement eligibility follows aggregate.py (rounded shares), which can class a
boundary case differently from the website (MONETIZATION-PLAN.md section 6).
"""

from __future__ import annotations

import argparse
import re
from datetime import date, timedelta
from pathlib import Path

import yaml

from .aggregate import brand_week, comparison_reason, load_history, movement
from .brand_report import bucket, categories, measured, private_path
from .storage import write_text

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "private"
SITE = "https://unprompted.report"

NO_MEASUREMENT = "No eligible measurement this issue."
NO_BASELINE = "No comparable earlier measurement"
NO_MOVEMENT = "No movement met the reporting threshold."


def section(category: str, monday: date) -> dict:
    runs = load_history(ROOT / "data" / "runs", category)
    end = (monday + timedelta(days=7)).isoformat()
    eligible = [i for i, r in enumerate(runs) if monday.isoformat() <= measured(r) < end]
    if not eligible:
        return {"category": category, "status": NO_MEASUREMENT, "movers": []}
    i = eligible[-1]
    run, previous = runs[i], (runs[i - 1] if i else None)
    for r in filter(None, (run, previous)):
        for e in r.get("extractions", []):
            bucket(e)  # malformed flags stop the draft, as they stop a report
    now = brand_week(run)
    out = {"category": category, "measured": measured(run), "read": run["run_date"],
           "leader": now[0] if now else None, "top": now[:5], "movers": []}
    reason = comparison_reason(run, previous)
    if reason:
        out["status"] = f"{NO_BASELINE}: {reason}"
        return out
    out["previous"] = measured(previous)
    out["movers"] = [m for m in movement(now, brand_week(previous)) if m.significant and m.rotation_delta]
    out["status"] = None if out["movers"] else NO_MOVEMENT
    return out


def md(text) -> str:
    """Archived names are untrusted: keep them literal text in Markdown and HTML."""
    return re.sub(r"([\\`*_\[\]()!#|<>~{}+.-])", r"\\\1", str(text))


def label(category: str) -> str:
    spec = yaml.safe_load((ROOT / "questions" / f"{category}.yml").read_text(encoding="utf-8")) or {}
    return spec.get("label") or category


def render(monday: date, sections: list[dict]) -> str:
    lines = [f"# Unprompted: week of {monday.isoformat()}", "",
             "_Draft for review. Every number below comes from the published archive; edit wording, not figures._", ""]
    for s in sections:
        lines += [f"## {md(label(s['category']))}", ""]
        if "measured" in s:
            lines.append(f"Measured {s['measured']}" + (f" (read {s['read']})" if s["read"] != s["measured"] else "")
                         + (f", compared with {s['previous']}" if s.get("previous") else "") + ".")
            if s["leader"]:
                b = s["leader"]
                lines.append(f"Named first most often: **{md(b.brand)}**, first in {b.first_named} of {b.total_runs} answers.")
            lines += ["", "Top five, ranked by how often each was named first (as on the chart):"]
            lines += [f"{n}. {md(b.brand)}: first in {b.first_named}, named at all in {b.named} of {b.total_runs}"
                      for n, b in enumerate(s["top"], 1)]
            lines.append("")
        if s["status"]:
            lines.append(s["status"])
        for m in sorted(s["movers"], key=lambda m: -abs(m.rotation_delta)):
            what = "dropped out" if m.is_dropout else f"{m.rotation_delta:+.1f} points"
            lines.append(f"- {md(m.brand)}: {what} in how often it was named")
        lines += ["", f"Full chart: {SITE}/chart/{s['category']}", ""]
    lines += ["---", "_Movement here follows the pipeline's rounding; a borderline case can be classed differently on the website._"]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--week", required=True, help="the Monday that starts the issue week (YYYY-MM-DD)")
    args = parser.parse_args()
    monday = date.fromisoformat(args.week)
    if monday.weekday() != 0:
        raise SystemExit("--week must be a Monday")
    path = private_path("newsletter", f"{monday.isoformat()}.md")
    write_text(path, render(monday, [section(c, monday) for c in sorted(categories())]))
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
