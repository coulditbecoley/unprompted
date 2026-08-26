"""What a run actually cost.

Rates live in data/rates.json and nowhere else, so there is exactly one place
to correct when a provider changes price -- and the dashboard prices a run from
that same file rather than a second copy that drifts. Every figure is computed
from usage the providers reported, not from an estimate of how many tokens we
think we sent.

The one number this cannot see is a provider's own dashboard. Treat the output
as an accurate reading of *our* usage against *published* rates, and reconcile
against a real invoice once a month.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Rates moved out to data/rates.json so the dashboard can price a run from the
# same numbers this does. Two copies of a price list is two answers to "what did
# the week cost", and the wrong one is always the one being read.
_RATES_FILE = json.loads((ROOT / "data" / "rates.json").read_text(encoding="utf-8"))

RATES: dict[str, dict[str, float]] = {
    name: {k: v for k, v in rate.items() if isinstance(v, (int, float))}
    for name, rate in _RATES_FILE["engines"].items()
}
BATCH_DISCOUNT: float = _RATES_FILE["batch_discount"]
BATCH_BILLED: frozenset[str] = frozenset(_RATES_FILE["batch_billed_extractors"])


@dataclass
class LineItem:
    label: str
    calls: int
    input_tokens: int
    output_tokens: int
    searches: int
    dollars: float

    @property
    def per_call(self) -> float:
        return self.dollars / self.calls if self.calls else 0.0


def _to_cents(total: float) -> float:
    """Four decimal places, rounding a half away from zero.

    Not `round()`. Python rounds halves to even and JavaScript rounds them up,
    so the two implementations disagreed on an exact tie: $0.03125 -- 25,000
    ChatGPT input tokens at the checked-in rate -- came to $0.0312 in the
    terminal and $0.0313 on the dashboard. No archived run happens to land on a
    tie, so the agreement suite passed while the rule differed.

    Written as floor(x + 0.5) because that is precisely what JavaScript's
    Math.round does, on the same IEEE-754 doubles, so the two are the same
    arithmetic rather than two roundings that usually agree.
    """
    return math.floor(total * 10_000 + 0.5) / 10_000


def batch_billed(extractor: str | None) -> bool:
    """Did this run's extraction go through the Batch API, and so at half price?

    A run names the registry id of the extractor that read it. This tested the
    literal string "api" until 2026-08-26, which the pipeline stopped writing
    when it started recording real provenance -- see run.py, which says so in a
    comment directly above the field. The result was silent and expensive in the
    wrong direction: every hosted run would have priced its extraction at double,
    on a dashboard built to answer "what did this cost".

    Nothing caught it because no archived run has ever used the hosted path, so
    the discount branch was never executed by any test. There is a synthetic one
    now, and it asserts the half-price figure rather than only that the two
    implementations agree -- two implementations of the same wrong rule agree
    perfectly.
    """
    return bool(extractor) and extractor in BATCH_BILLED


def _price(engine: str, usage: dict[str, int]) -> float:
    rate = RATES.get(engine)
    if not rate:
        return 0.0
    searches = usage.get("web_searches", 0) or usage.get("requests", 0)
    return (
        usage.get("input_tokens", 0) / 1_000_000 * rate["input_per_m"]
        + usage.get("output_tokens", 0) / 1_000_000 * rate["output_per_m"]
        + searches * rate["per_search"]
    )


def cost_of_run(run: dict) -> tuple[list[LineItem], float]:
    """Per-engine line items plus the total, from reported usage only.

    Runs recorded before usage was instrumented return zeros rather than a
    guess. A missing measurement should look missing.
    """
    buckets: dict[str, LineItem] = {}
    extract_rate = BATCH_DISCOUNT if batch_billed(run.get("extractor")) else 1.0

    for ex in run.get("extractions", []):
        engine = ex.get("engine", "unknown")
        usage = ex.get("usage") or {}
        item = buckets.setdefault(
            engine, LineItem(engine, 0, 0, 0, 0, 0.0)
        )
        item.calls += 1
        item.input_tokens += usage.get("input_tokens", 0)
        item.output_tokens += usage.get("output_tokens", 0)
        item.searches += usage.get("web_searches", 0) or usage.get("requests", 0)
        item.dollars += _price(engine, usage)

        # The extraction pass rides on the same record but is billed separately,
        # so it gets its own line rather than inflating the engine it read.
        ein = usage.get("extract_input_tokens", 0)
        eout = usage.get("extract_output_tokens", 0)
        if ein or eout:
            ex_item = buckets.setdefault(
                "_extract", LineItem("extract", 0, 0, 0, 0, 0.0)
            )
            ex_item.calls += 1
            ex_item.input_tokens += ein
            ex_item.output_tokens += eout
            ex_item.dollars += extract_rate * _price(
                "_extract", {"input_tokens": ein, "output_tokens": eout}
            )

    items = sorted(buckets.values(), key=lambda i: -i.dollars)
    return items, _to_cents(sum(i.dollars for i in items))


def format_report(run: dict) -> str:
    items, total = cost_of_run(run)
    if not items:
        return "no usage recorded"

    lines = [
        f"{'engine':<12} {'calls':>6} {'in tokens':>12} {'out tokens':>11} "
        f"{'searches':>9} {'cost':>9}"
    ]
    for i in items:
        lines.append(
            f"{i.label:<12} {i.calls:>6} {i.input_tokens:>12,} "
            f"{i.output_tokens:>11,} {i.searches:>9} {'$%.2f' % i.dollars:>9}"
        )
    lines.append(f"{'TOTAL':<12} {'':>6} {'':>12} {'':>11} {'':>9} {'$%.2f' % total:>9}")
    lines.append("")
    lines.append(f"per week ${total:.2f} · per year ${total * 52:.2f}")
    return "\n".join(lines)
