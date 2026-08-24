"""Engine clients.

Every engine exposes the same callable shape:

    ask(question_id, question, runs) -> list[EngineAnswer]

Each engine is queried natively, using that provider's own web search where it
exists. We deliberately do not route through a multi-provider aggregator: an
aggregator supplies one shared search context to every model, which would make
the engines agree artificially and would report the aggregator's sources rather
than each assistant's own.

An engine that is not configured reports itself unavailable rather than raising,
so a missing key degrades the week instead of ending it.

The three hosted engines are built in because they are the definition of the
series. Local CLI harnesses can be added as further engines from the admin
dashboard, which writes them into providers.json; they are charted as their own
rows under their own names and never stand in for a hosted engine. See
cli_engine.py for why those are different products despite similar names.
"""

from __future__ import annotations

from ..cli_provider import declared_clis
from .anthropic_engine import AnthropicEngine
from .base import Engine
from .cli_engine import CliEngine
from .openai_engine import OpenAIEngine
from .perplexity_engine import PerplexityEngine

ENGINES = {
    "chatgpt": OpenAIEngine,
    "claude": AnthropicEngine,
    "perplexity": PerplexityEngine,
}


def all_engines() -> dict[str, Engine]:
    """Every engine a run is supposed to query, hosted and local.

    Declared, not filtered by availability. A registered engine this machine
    cannot run is a reason for the caller to stop rather than to quietly measure
    a smaller field: which assistants answered is part of what a week means.
    """
    engines: dict[str, Engine] = {name: cls() for name, cls in ENGINES.items()}
    for provider in declared_clis("engine"):
        engines[provider.id] = CliEngine(provider)
    return engines


def available_engines() -> list[str]:
    """Engine names this machine could actually query right now."""
    return sorted(name for name, engine in all_engines().items() if engine.is_configured)


__all__ = [
    "AnthropicEngine",
    "CliEngine",
    "OpenAIEngine",
    "PerplexityEngine",
    "ENGINES",
    "all_engines",
    "available_engines",
]
