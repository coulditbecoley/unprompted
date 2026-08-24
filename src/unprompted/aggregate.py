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
    # One step per question, valued 0..1 by how often this brand was named for
    # that question. A step sequencer already has this idea: it is velocity.
    # Rendering one cell per run put 225 cells in a row, which overflowed the
    # page; 15 steps with intensity is both readable and more informative,
    # because it shows *which* questions a brand wins.
    steps: list[float] = field(default_factory=list)

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

    # Question order is taken from first appearance so the steps line up with
    # the published question bank rather than sorting alphabetically.
    question_order: list[str] = []
    for ex in answers:
        qid = ex.get("question_id", "")
        if qid and qid not in question_order:
            question_order.append(qid)

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

        steps: list[float] = []
        for qid in question_order:
            for_q = [e for e in answers if e.get("question_id") == qid]
            if not for_q:
                steps.append(0.0)
                continue
            hits = sum(
                1 for e in for_q if any(b["name"] == name for b in e.get("brands", []))
            )
            steps.append(round(hits / len(for_q), 4))

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
                steps=steps,
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


@dataclass
class SelfPreference:
    """How often an engine names its own product, versus how often rivals do.

    The whole reason the AI-tools category exists. `own_rate` is the share of
    that engine's answered runs naming the product; `rival_rate` is the same
    across every other engine. A gap means the engine favours its own house.

    Reported as a measurement with its sample size attached, never as an
    accusation: a small gap on a small sample is noise, and saying so is the
    difference between a finding and a headline we cannot defend.
    """

    brand: str
    engine: str            # the engine, or engines, that own this product
    own_named: int
    own_runs: int
    own_rate: float
    rival_named: int
    rival_runs: int
    rival_rate: float

    @property
    def gap(self) -> float:
        """Percentage points by which the owner out-names everyone else."""
        return round((self.own_rate - self.rival_rate) * 100, 1)

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "gap": self.gap}


def self_preference(
    run: dict, affiliations: dict[str, list[str]]
) -> list[SelfPreference]:
    """For each product with a known owner, compare owner naming to rival naming."""
    answers = _answered(run)
    out: list[SelfPreference] = []

    for brand, owner in sorted(affiliations.items()):
        owners = [owner] if isinstance(owner, str) else list(owner)
        own = [e for e in answers if e.get("engine") in owners]
        rival = [e for e in answers if e.get("engine") not in owners]
        if not own or not rival:
            continue

        def named_in(rows: list[dict]) -> int:
            return sum(
                1 for e in rows if any(b["name"] == brand for b in e.get("brands", []))
            )

        own_named = named_in(own)
        rival_named = named_in(rival)
        out.append(
            SelfPreference(
                brand=brand,
                engine=", ".join(owners),
                own_named=own_named,
                own_runs=len(own),
                own_rate=round(own_named / len(own), 4),
                rival_named=rival_named,
                rival_runs=len(rival),
                rival_rate=round(rival_named / len(rival), 4),
            )
        )

    out.sort(key=lambda s: -s.gap)
    return out


def load_affiliations(path: str | Path) -> dict[str, list[str]]:
    """Read the brand -> owning-engines map from a category's alias file.

    A value may be one engine name or a list of them. A list is needed because
    one vendor can field more than one engine: Anthropic answers as both the
    hosted `claude` API and the local `claude-code` harness, and counting the
    second as a rival of the first would understate exactly the self-preference
    this publication exists to measure.
    """
    import yaml

    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    raw = data.get("affiliations", {}) or {}
    return {
        brand: [owner] if isinstance(owner, str) else list(owner)
        for brand, owner in raw.items()
    }
