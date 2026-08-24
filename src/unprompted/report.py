"""Turn a run into a readable weekly note.

The raw JSON is the record; this is the thing a human reads. It is written into
the repository so the scheduled cloud run produces it, and synced into the
Obsidian vault so the archive lives somewhere that survives the project.

Deliberately plain markdown with no Obsidian-specific syntax beyond frontmatter,
so the same file is readable on GitHub and in the vault.
"""

from __future__ import annotations

from pathlib import Path

from .aggregate import (
    brand_week,
    load_affiliations,
    load_history,
    movement,
    self_preference,
    source_counts,
    the_snub,
)
from .cost import cost_of_run


def pretty(slug: str) -> str:
    """Human title from a slug, without a second registry to keep in sync."""
    return " ".join(
        word.upper() if word in {"ai", "seo"} else word.capitalize()
        for word in slug.split("-")
    )


def build_report(run: dict, history: list[dict], aliases_path: Path) -> str:
    """Render one run as markdown."""
    category = run["category"]
    date = run["run_date"]
    board = brand_week(run)

    prior = [h for h in history if h["run_date"] < date]
    last = brand_week(prior[-1]) if prior else []
    moves = movement(board, last)
    move_for = {m.brand: m for m in moves}
    snub = the_snub(moves)

    preference = self_preference(run, load_affiliations(aliases_path))
    sources = source_counts(run)[:10]
    _, cost = cost_of_run(run)
    leader = board[0] if board else None

    out: list[str] = []
    out.append("---")
    out.append("type: unprompted-week")
    out.append(f"category: {category}")
    out.append(f"date: {date}")
    out.append(f"method_version: {run['method_version']}")
    out.append(f"engines: {', '.join(run['engines'])}")
    out.append(f"extractor: {run.get('extractor', 'api')}")
    out.append("---")
    out.append("")
    out.append(f"# {pretty(category)}, week of {date}")
    out.append("")

    if leader:
        out.append(
            f"**{leader.brand} leads**, named first in "
            f"{leader.first_share:.0%} of runs and named at all in "
            f"{leader.named} of {leader.total_runs}."
        )
    else:
        out.append("**No brand was named this week.**")
    out.append("")
    out.append(
        f"{run['runs_per_question']} runs per question across "
        f"{len(run['engines'])} engines. Method v{run['method_version']}."
        + (f" Cost ${cost:.2f}." if cost else "")
    )
    out.append("")

    out.append("## Standings")
    out.append("")
    out.append("| # | Brand | Named | Rotation | First |  |")
    out.append("|---|---|---|---|---|---|")
    for i, b in enumerate(board, 1):
        m = move_for.get(b.brand)
        if m is None or (not m.is_new and m.rotation_delta == 0):
            delta = ""
        elif m.is_new:
            delta = "new"
        else:
            delta = f"{'+' if m.rotation_delta > 0 else ''}{m.rotation_delta}"
        out.append(
            f"| {i} | {b.brand} | {b.named}/{b.total_runs} | "
            f"{b.rotation:.0%} | {b.first_share:.0%} | {delta} |"
        )
    out.append("")

    if snub:
        out.append("## The Snub")
        out.append("")
        detail = (
            "Named last week, not named once this week."
            if snub.is_dropout
            else f"Down {abs(snub.rotation_delta)} points week over week."
        )
        out.append(f"**{snub.brand}**: {detail}")
        out.append("")

    if preference:
        out.append("## Does an engine favour its own tool?")
        out.append("")
        out.append("| Product | Made by | Its own | Rivals | Gap |")
        out.append("|---|---|---|---|---|")
        for p in preference:
            out.append(
                f"| {p.brand} | {p.engine} | {p.own_rate:.0%} "
                f"({p.own_named}/{p.own_runs}) | {p.rival_rate:.0%} "
                f"({p.rival_named}/{p.rival_runs}) | "
                f"{'+' if p.gap > 0 else ''}{p.gap} |"
            )
        out.append("")
        out.append(
            "A gap is a measurement, not an accusation. The extraction step "
            "runs on Claude, so any figure involving a Claude product is "
            "provisional until re-checked with a different extractor."
        )
        out.append("")

    if sources:
        out.append("## What the answers were built from")
        out.append("")
        for host, count in sources:
            out.append(f"- {host} ({count})")
        out.append("")

    out.append("---")
    out.append("")
    out.append(
        f"Raw data: `data/runs/{date}/{category}.json` · "
        f"[unprompted.report](https://unprompted.report/chart/{category})"
    )
    return "\n".join(out) + "\n"


def write_report(run: dict, root: Path) -> Path:
    """Write the note into the repository, next to the data it describes."""
    history = load_history(root / "data" / "runs", run["category"])
    aliases = root / "aliases" / f"{run['category']}.yml"
    text = build_report(run, history, aliases)

    out_dir = root / "reports" / run["run_date"]
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{run['category']}.md"
    path.write_text(text, encoding="utf-8")
    return path
