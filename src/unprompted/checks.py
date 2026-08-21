"""The four sanity rules that stand between a run and the public site.

Fail safe, never fail open: if any rule trips, nothing publishes and a human
looks at it. An embarrassing published chart costs more than a missed week.
"""

from __future__ import annotations

from dataclasses import dataclass

from .aggregate import BrandWeek

# Starting thresholds. Tune after four weeks of real baseline and bump the
# methodology version when you do.
MAX_ROTATION_SWING = 40.0    # percentage points, week over week
MAX_ERROR_RATE = 0.20        # share of engine calls allowed to fail
MIN_BRANDS = 2               # a grading field returns ~5-8; 20 means drift
MAX_BRANDS = 15


@dataclass
class CheckResult:
    passed: bool
    reasons: list[str]

    @property
    def held(self) -> bool:
        return not self.passed


def run_checks(
    run: dict,
    this_week: list[BrandWeek],
    last_week: list[BrandWeek],
) -> CheckResult:
    """Return pass/fail plus every human-readable reason it failed."""
    reasons: list[str] = []

    # 1. Quarantine is not empty. An unrecognised name means either a new brand
    #    worth adding to the alias map, or a hallucination. Both need a human.
    quarantined = run.get("quarantined", [])
    if quarantined:
        shown = ", ".join(sorted(set(quarantined))[:8])
        reasons.append(
            f"{len(set(quarantined))} unrecognised brand name(s) quarantined: {shown}"
        )

    # 2. Implausible week-over-week swing.
    prev = {b.brand: b for b in last_week}
    for brand in this_week:
        before = prev.get(brand.brand)
        if before is None:
            continue
        swing = abs(brand.rotation - before.rotation) * 100
        if swing > MAX_ROTATION_SWING:
            reasons.append(
                f"{brand.brand} rotation moved {swing:.0f} points "
                f"({before.rotation:.0%} to {brand.rotation:.0%}), over the "
                f"{MAX_ROTATION_SWING:.0f}-point limit"
            )

    # 3. Too many engine calls failed for the week to be representative.
    extractions = run.get("extractions", [])
    if extractions:
        errored = sum(1 for e in extractions if e.get("error"))
        rate = errored / len(extractions)
        if rate > MAX_ERROR_RATE:
            reasons.append(
                f"{rate:.0%} of engine calls errored "
                f"({errored} of {len(extractions)}), over the {MAX_ERROR_RATE:.0%} limit"
            )
    else:
        reasons.append("run produced no extractions at all")

    # 4. Brand count outside the expected band for a small field.
    count = len(this_week)
    if count and not (MIN_BRANDS <= count <= MAX_BRANDS):
        reasons.append(
            f"{count} distinct brands found, outside the expected "
            f"{MIN_BRANDS}-{MAX_BRANDS} range"
        )

    return CheckResult(passed=not reasons, reasons=reasons)
