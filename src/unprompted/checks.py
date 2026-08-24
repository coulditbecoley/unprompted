"""The five sanity rules that stand between a run and the public site.

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
# Measured against the first real run: 24 distinct companies appeared, but the
# long tail was named once or twice out of 225. Counting raw distinct names
# would hold the week forever on a perfectly healthy result, so the bound
# applies to brands above a noise floor. This is an operational threshold, not a
# measurement definition: no published number changes, only whether we publish.
MIN_ROTATION_TO_COUNT = 0.02  # named in at least ~2% of runs
MIN_BRANDS = 2
# How wide a field is plausible is a property of the category, not a global
# truth. Grading has five or six real companies; AI coding tools genuinely has
# eighteen. A category may raise this via max_brands in its questions file.
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
    max_brands: int = MAX_BRANDS,
    previous: dict | None = None,
) -> CheckResult:
    """Return pass/fail plus every human-readable reason it failed."""
    reasons: list[str] = []

    # 0. The series rule, enforced rather than merely written down.
    #
    # METHODOLOGY.md says changing the list of active engines changes what the
    # numbers mean and must bump the method version. Until now that was an
    # instruction to the operator and nothing checked it, so registering a new
    # engine — a local CLI harness, say — would silently produce a week that
    # was not comparable to the one before it and publish it as if it were.
    if previous:
        before = sorted(previous.get("engines", []))
        now = sorted(run.get("engines", []))
        if before and before != now:
            same_version = previous.get("method_version") == run.get("method_version")
            if same_version:
                added = [e for e in now if e not in before]
                removed = [e for e in before if e not in now]
                changed = ", ".join(
                    [f"+{e}" for e in added] + [f"-{e}" for e in removed]
                )
                reasons.append(
                    f"the engine list changed ({changed}) but method_version is "
                    f"still {run.get('method_version')}. A different set of "
                    f"assistants answered, so this week is not comparable to the "
                    f"last one: bump method_version in the question bank, or "
                    f"restore the previous engines."
                )

    # 1. A *material* unrecognised name. These engines name long-tail shops and
    #    services constantly, so holding on any single unknown would hold every
    #    week forever and the chart would never publish itself. A name appearing
    #    once in 225 runs cannot move the standings: it is logged for review and
    #    the week still ships. Only a name appearing often enough to matter is
    #    worth stopping for.
    quarantined = run.get("quarantined", [])
    if quarantined:
        total = this_week[0].total_runs if this_week else 0
        counts: dict[str, int] = {}
        for name in quarantined:
            counts[name] = counts.get(name, 0) + 1
        material = sorted(
            (n for n, c in counts.items() if total and c / total >= MIN_ROTATION_TO_COUNT),
            key=lambda n: -counts[n],
        )
        if material:
            shown = ", ".join(material[:8])
            reasons.append(
                f"{len(material)} unrecognised brand name(s) appeared in at least "
                f"{MIN_ROTATION_TO_COUNT:.0%} of runs and need a decision: {shown}"
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

    # 4. Brand count outside the expected band, ignoring the one-mention tail.
    count = sum(1 for b in this_week if b.rotation >= MIN_ROTATION_TO_COUNT)
    # Zero is a failing count, not an exemption. Guarding this with `if count`
    # let a week in which every answer refused, or named nothing, pass every
    # rule and publish an empty board as a market result.
    if not (MIN_BRANDS <= count <= max_brands):
        reasons.append(
            f"{count} brands above the {MIN_ROTATION_TO_COUNT:.0%} floor, outside "
            f"the expected {MIN_BRANDS}-{max_brands} range "
            f"({len(this_week)} distinct names in total)"
        )

    return CheckResult(passed=not reasons, reasons=reasons)
