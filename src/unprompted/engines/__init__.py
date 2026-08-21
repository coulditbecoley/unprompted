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
"""

from __future__ import annotations

from .anthropic_engine import AnthropicEngine
from .openai_engine import OpenAIEngine
from .perplexity_engine import PerplexityEngine

ENGINES = {
    "chatgpt": OpenAIEngine,
    "claude": AnthropicEngine,
    "perplexity": PerplexityEngine,
}


def available_engines() -> list[str]:
    """Engine names whose credentials are actually present."""
    return [name for name, cls in ENGINES.items() if cls().is_configured]


__all__ = [
    "AnthropicEngine",
    "OpenAIEngine",
    "PerplexityEngine",
    "ENGINES",
    "available_engines",
]
