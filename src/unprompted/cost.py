"""What a run actually cost.

Rates live here and nowhere else, so there is exactly one place to correct when
a provider changes price. Every figure is computed from usage the providers
reported, not from an estimate of how many tokens we think we sent.

The one number this cannot see is a provider's own dashboard. Treat the output
as an accurate reading of *our* usage against *published* rates, and reconcile
against a real invoice once a month.
"""

from __future__ import annotations

from dataclasses import dataclass

# Dollars per million tokens, and dollars per billable search or request.
# Verified 2026-08-22. Correct these here when a provider changes price, and
# note the date, because past runs were billed at the rates of their own week.
RATES: dict[str, dict[str, float]] = {
    "claude": {
        "input_per_m": 5.00,      # claude-opus-5
        "output_per_m": 25.00,
        "per_search": 0.010,      # server-side web search, per search
    },
    "chatgpt": {
        "input_per_m": 1.25,      # gpt-5
        "output_per_m": 10.00,
        "per_search": 0.010,      # web search tool, per call
    },
    "perplexity": {
        "input_per_m": 1.00,      # sonar
        "output_per_m": 1.00,
        "per_search": 0.005,      # per-request search fee
    },
    # The extraction pass, billed as ordinary Anthropic tokens. List price; the
    # batch discount below is applied on top when the run actually used batch.
    "_extract": {
        "input_per_m": 5.00,
        "output_per_m": 25.00,
        "per_search": 0.0,
    },
}

# The weekly extraction pass goes through the Batch API at half list price.
# Applied as a multiplier rather than baked into the rates above, because a
# re-read of a handful of answers still goes out as live calls and is billed in
# full. A run records which extractor read it, so this is read off the run
# rather than assumed.
BATCH_DISCOUNT = 0.5


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
    # "api" is the batch path; any other value is a local CLI, which reports no
    # extraction tokens at all and so never reaches the discount.
    extract_rate = BATCH_DISCOUNT if run.get("extractor") == "api" else 1.0

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
    return items, round(sum(i.dollars for i in items), 4)


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
