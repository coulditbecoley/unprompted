"""Turn run records into the numbers the site publishes.

The metric definitions live here and are fixed. Changing any of them changes
what every past week means, so a change here is a methodology version bump.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from statistics import median
from typing import Any


@dataclass
class BrandWeek:
    """One brand's standing for one week in one category."""

    brand: str
    named: int                 # runs in which the brand appeared
    total_runs: int            # runs that actually produced an answer
    rotation: float            # named / total_runs
    first_named: int           # runs in which it was named first
    first_share: float         # first_named / total_runs
    median_position: float | None
    cells: list[bool] = field(default_factory=list)   # one per run, in run order

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Movement:
    brand: str
    rotation_delta: float      # percentage points, this week minus last
    first_share_delta: float
    is_new: bool
    is_dropout: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _answered(run: dict) -> list[dict]:
    """Extractions that produced a usable answer: no error, not a refusal."""
    return [
        e for e in run.get("extractions", [])
        if not e.get("error") and not e.get("refused")
    ]


def brand_week(run: dict) -> list[BrandWeek]:
    """Compute every brand's standing for one run record.

    Sorted by first_share, then rotation, then name. In a small field the
    leader's rotation pins near 100% and stops moving, so ordering leads on
    first-named share, which keeps discriminating.
    """
    answers = _answered(run)
    total = len(answers)
    if total == 0:
        return []

    names: set[str] = set()
    for ex in answers:
        for b in ex.get("brands", []):
            names.add(b["name"])

    out: list[BrandWeek] = []
    for name in names:
        cells: list[bool] = []
        positions: list[int] = []
        first = 0
        for ex in answers:
            hit = next((b for b in ex.get("brands", []) if b["name"] == name), None)
            cells.append(hit is not None)
            if hit is not None:
                positions.append(hit["position"])
                if hit["position"] == 1:
                    first += 1
        named = sum(cells)
        out.append(
            BrandWeek(
                brand=name,
                named=named,
                total_runs=total,
                rotation=round(named / total, 4),
                first_named=first,
                first_share=round(first / total, 4),
                median_position=round(median(positions), 2) if positions else None,
                cells=cells,
            )
        )

    out.sort(key=lambda b: (-b.first_share, -b.rotation, b.brand))
    return out


def movement(this_week: list[BrandWeek], last_week: list[BrandWeek]) -> list[Movement]:
    """Week-over-week change, including entrants and dropouts."""
    prev = {b.brand: b for b in last_week}
    curr = {b.brand: b for b in this_week}
    moves: list[Movement] = []

    for brand, now in curr.items():
        before = prev.get(brand)
        moves.append(
            Movement(
                brand=brand,
                rotation_delta=round((now.rotation - (before.rotation if before else 0.0)) * 100, 1),
                first_share_delta=round((now.first_share - (before.first_share if before else 0.0)) * 100, 1),
                is_new=before is None,
                is_dropout=False,
            )
        )

    for brand, before in prev.items():
        if brand not in curr:
            moves.append(
                Movement(
                    brand=brand,
                    rotation_delta=round(-before.rotation * 100, 1),
                    first_share_delta=round(-before.first_share * 100, 1),
                    is_new=False,
                    is_dropout=True,
                )
            )

    moves.sort(key=lambda m: m.rotation_delta)
    return moves


def the_snub(moves: list[Movement]) -> Movement | None:
    """The week's biggest faller. A dropout always outranks a mere decline.

    Returns None when nothing actually fell, because inventing drama from a
    quiet week is how a chart loses trust.
    """
    if not moves:
        return None
    dropouts = [m for m in moves if m.is_dropout]
    if dropouts:
        return min(dropouts, key=lambda m: m.rotation_delta)
    worst = min(moves, key=lambda m: m.rotation_delta)
    return worst if worst.rotation_delta < 0 else None


def source_counts(run: dict) -> list[tuple[str, int]]:
    """Which domains fed the answers, most cited first."""
    from urllib.parse import urlparse

    counts: dict[str, int] = {}
    for ex in _answered(run):
        for url in ex.get("sources", []):
            try:
                host = urlparse(url).netloc.lower().removeprefix("www.")
            except ValueError:
                continue
            if host:
                counts[host] = counts.get(host, 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def load_history(runs_dir: str | Path, category: str) -> list[dict]:
    """Every run for a category, oldest first."""
    root = Path(runs_dir)
    if not root.exists():
        return []
    files = sorted(root.glob(f"*/{category}.json"))
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]
