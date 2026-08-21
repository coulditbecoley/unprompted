"""Shared engine behaviour: timing, retries, and never raising."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone

from ..models import EngineAnswer

# The instruction each engine receives. Deliberately plain: we want the
# assistant's ordinary shopping answer, not a formatted one. Asking for a list
# would change what we are measuring.
SYSTEM_PROMPT = (
    "You are answering a shopper's question. Answer normally and concisely, "
    "the way you would for any user asking what to buy or which service to use. "
    "Name specific companies where you would normally name them."
)

MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_key(*names: str) -> str | None:
    """First non-empty environment variable among `names`."""
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


class Engine:
    """Base class. Subclasses implement `_one_call`."""

    name: str = "engine"
    key_names: tuple[str, ...] = ()

    def __init__(self) -> None:
        self.api_key = read_key(*self.key_names)

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _one_call(self, question: str) -> tuple[str, list[str]]:
        """Return (answer_text, source_urls). May raise; the caller handles it."""
        raise NotImplementedError

    def ask_one(self, question_id: str, question: str, run_index: int) -> EngineAnswer:
        """One call, with retries. Never raises.

        A failure after retries becomes an EngineAnswer carrying `error`, which
        is recorded as data. One dead engine must not cost the week.
        """
        if not self.is_configured:
            return EngineAnswer(
                engine=self.name,
                question_id=question_id,
                question=question,
                run_index=run_index,
                error="not configured: no API key present",
                fetched_at=utc_now(),
            )

        text, sources, error = "", [], None
        for attempt in range(MAX_ATTEMPTS):
            try:
                text, sources = self._one_call(question)
                error = None
                break
            except Exception as exc:  # noqa: BLE001 - recorded, not raised
                error = f"{type(exc).__name__}: {exc}"
                if attempt < MAX_ATTEMPTS - 1:
                    time.sleep(BACKOFF_SECONDS * (attempt + 1))

        return EngineAnswer(
            engine=self.name,
            question_id=question_id,
            question=question,
            run_index=run_index,
            text=text,
            sources=sources,
            error=error,
            fetched_at=utc_now(),
        )

    def ask(self, question_id: str, question: str, runs: int) -> list[EngineAnswer]:
        """Sequential convenience wrapper. The orchestrator parallelises instead:
        measured serially, a full week is roughly 2.5 hours of wall clock."""
        return [self.ask_one(question_id, question, i) for i in range(runs)]
