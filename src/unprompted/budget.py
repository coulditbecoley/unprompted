"""Refuse to start a week that cannot be paid for.

On 2026-08-24 the account hit its API spend cap partway through a category.
Claude failed 24 of 75 calls, the other two engines answered everything, and the
run published a week measured on two and two-thirds engines. The money for the
51 answers that did arrive was spent and produced a chart that had to be
caveated in public.

That is the failure this exists to prevent, and the shape of the fix follows
from it: the expensive moment is not the run, it is the *half* run. A week that
never starts costs nothing and can be run tomorrow. A week that stops halfway
has spent most of its money and produced something unpublishable.

What this is not: a reading of anybody's real balance. No provider exposes one
worth relying on, and cost.py already says its figures are our usage against
published rates rather than an invoice. So this is a budget the operator sets
and this code defends, reconciled against a real bill monthly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .cost import cost_of_run

ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = ROOT / "data" / "runs"
HELD_DIR = ROOT / "data" / "held"
_RATES_FILE = json.loads((ROOT / "data" / "rates.json").read_text(encoding="utf-8"))

# Dollars a calendar month of measuring may cost before this refuses to start
# another category. Set in data/rates.json beside the prices it is denominated
# in, because a ceiling and the rates it is measured against go stale together.
MONTHLY_CEILING: float = float(_RATES_FILE.get("monthly_ceiling", 0.0) or 0.0)

# What a category is assumed to cost when nothing comparable has been recorded.
# Only used when the archive cannot answer, and deliberately generous: guessing
# low here would defeat the entire point.
FALLBACK_PER_ANSWER = 0.15


@dataclass
class Estimate:
    """What a run is expected to cost, and where that expectation came from."""

    dollars: float
    basis: str
    confident: bool


@dataclass
class Verdict:
    ok: bool
    spent: float
    estimate: Estimate
    ceiling: float
    message: str

    @property
    def projected(self) -> float:
        return self.spent + self.estimate.dollars


def _archived_runs() -> list[dict]:
    """Every run this repo has recorded, published or held.

    Held runs are included because they were paid for. A ceiling that ignored
    them would let a month of failures spend without limit, which is precisely
    the month in which a limit matters most.
    """
    out: list[dict] = []
    for base in (RUNS_DIR, HELD_DIR):
        if not base.exists():
            continue
        for day in sorted(base.iterdir()):
            if not day.is_dir():
                continue
            for file in sorted(day.glob("*.json")):
                try:
                    out.append(json.loads(file.read_text(encoding="utf-8")))
                except (OSError, json.JSONDecodeError):
                    # Unreadable is not free, but it is unknowable. The caller
                    # is told the estimate is unconfident rather than given a
                    # total that silently omits it.
                    continue
    return out


def spent_in_month(when: date, runs: list[dict] | None = None) -> float:
    """Recorded spend for the calendar month containing `when`."""
    prefix = when.strftime("%Y-%m")
    runs = _archived_runs() if runs is None else runs
    return round(
        sum(
            cost_of_run(r)[1]
            for r in runs
            if str(r.get("run_date", "")).startswith(prefix)
        ),
        4,
    )


def estimate_category(category: str, answers: int, runs: list[dict] | None = None) -> Estimate:
    """What one category is likely to cost, from what comparable runs did cost.

    Preference order, most specific first: this category's own most recent
    priced run, then any priced run, then a flat per-answer guess. Each step
    down is less trustworthy and says so, because a refusal has to be
    explainable -- an operator told "no" by a number they cannot account for
    will override it, and then the guard has achieved nothing.
    """
    runs = _archived_runs() if runs is None else runs
    priced = [(r, cost_of_run(r)[1]) for r in runs]
    priced = [(r, c) for r, c in priced if c > 0]

    def per_answer(record: dict, dollars: float) -> float:
        got = [e for e in record.get("extractions", []) if not e.get("error")]
        return dollars / len(got) if got else 0.0

    same = [(r, c) for r, c in priced if r.get("category") == category]
    if same:
        record, dollars = max(same, key=lambda rc: str(rc[0].get("run_date", "")))
        rate = per_answer(record, dollars)
        return Estimate(
            round(rate * answers, 2),
            f"{category} on {record.get('run_date')}, ${rate:.3f} an answer",
            True,
        )

    if priced:
        record, dollars = max(priced, key=lambda rc: str(rc[0].get("run_date", "")))
        rate = per_answer(record, dollars)
        return Estimate(
            round(rate * answers, 2),
            f"{record.get('category')} on {record.get('run_date')}, ${rate:.3f} an answer",
            True,
        )

    return Estimate(
        round(FALLBACK_PER_ANSWER * answers, 2),
        f"no priced run to compare against, assuming ${FALLBACK_PER_ANSWER:.2f} an answer",
        False,
    )


def check(category: str, answers: int, when: date | None = None) -> Verdict:
    """May this category run without taking the month over its ceiling?

    A ceiling of zero means none is set, and this always allows the run. Opt-in
    rather than opt-out: a guard that appears without being asked for, and stops
    a Monday the first time it is wrong, is a guard that gets deleted.
    """
    when = when or date.today()
    runs = _archived_runs()
    spent = spent_in_month(when, runs)
    estimate = estimate_category(category, answers, runs)

    if MONTHLY_CEILING <= 0:
        return Verdict(
            True, spent, estimate, 0.0,
            f"no monthly ceiling set; ${spent:.2f} recorded so far in "
            f"{when.strftime('%B')}.",
        )

    projected = spent + estimate.dollars
    if projected <= MONTHLY_CEILING:
        return Verdict(
            True, spent, estimate, MONTHLY_CEILING,
            f"${spent:.2f} spent this month, ~${estimate.dollars:.2f} for "
            f"{category}, against a ${MONTHLY_CEILING:.2f} ceiling "
            f"({estimate.basis}).",
        )

    return Verdict(
        False, spent, estimate, MONTHLY_CEILING,
        f"{category} is expected to cost ~${estimate.dollars:.2f} on top of "
        f"${spent:.2f} already recorded this month, which would reach "
        f"${projected:.2f} against a ceiling of ${MONTHLY_CEILING:.2f}.\n"
        f"Basis: {estimate.basis}.\n"
        f"A week that never starts costs nothing and can run tomorrow; a week "
        f"that stops halfway has spent most of its money and cannot be "
        f"published. Raise monthly_ceiling in data/rates.json, or pass "
        f"--ignore-budget to run it anyway.",
    )
