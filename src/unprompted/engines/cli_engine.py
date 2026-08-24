"""An engine that lives on this machine as a command line tool.

The three built-in engines are hosted APIs and cost money per question. A coding
agent already signed in on the operator's machine can answer the same question
on a subscription instead, and both harnesses this project knows about have live
web access, so the answer reflects what is on the web today rather than what was
in a training set.

WHAT THIS MEASURES, AND WHAT IT DOES NOT

A CLI harness is not the consumer product of the same name. `claude -p` is
Claude Code, a coding agent with a coding agent's system prompt; asked what the
best AI coding assistant is, it volunteers "I'm made by Anthropic, so take my
read on Claude products with that in mind", which the consumer assistant does
not do. `codex exec` is not ChatGPT, and in testing it ranked Claude Code above
OpenAI's own Codex.

So a CLI engine is registered under its own name and charted as its own row. It
never stands in for the API engine of a similar name. Substituting one for the
other would change what a row means partway through a series, which is the one
thing METHODOLOGY.md says must never happen quietly.

Two further differences, both visible in the published data:

* No citations. The hosted engines return a structured list of the pages their
  search actually used; a CLI prints prose on stdout and nothing else. Source
  counts for a CLI engine are therefore empty rather than wrong.
* No token counts, so the cost report shows $0.00 for these engines. That is
  accurate: the calls are billed to a subscription, not per token.
"""

from __future__ import annotations

from ..cli_provider import CliProvider, is_available
from .base import SYSTEM_PROMPT, Engine


class CliEngine(Engine):
    """Ask a local CLI harness a shopper's question."""

    key_names: tuple[str, ...] = ()

    def __init__(self, provider: CliProvider) -> None:
        self.provider = provider
        # The registry id is the engine name, so the chart row and the registry
        # entry cannot drift apart.
        self.name = provider.id
        self.label = provider.label
        self.api_key = None

    @property
    def is_configured(self) -> bool:
        """A CLI is configured when this machine can actually run it."""
        return is_available(self.provider)

    @property
    def unavailable_reason(self) -> str:
        return f"not available: {self.provider.command} is not on PATH"

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        # The harness gets the same instruction the hosted engines get, so the
        # only deliberate difference between rows is which assistant answered.
        text = self.provider.ask(f"{SYSTEM_PROMPT}\n\n{question}")
        return text.strip(), [], {}
