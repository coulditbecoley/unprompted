"""Shared engine behaviour: timing, retries, and never raising."""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path

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
RATE_LIMIT_BACKOFF_SECONDS = 15.0


def is_rate_limit(exc: Exception) -> bool:
    status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    text = str(exc).lower()
    return status == 429 or "ratelimit" in type(exc).__name__.lower() or "rate_limit" in text or "429" in text

# Every wait and every new paid request in one weekly run shares this clock.
# Task Scheduler stops the run at 8 hours, and a run killed there commits
# nothing at all, so work ends an hour short of it and the categories that did
# pass still publish. The clock starts when the launcher did
# (scripts/weekly-run.cmd writes .unprompted/weekly-started), not when Python
# imported this module after the launcher's own git and preflight steps.
RUN_SECONDS = 7 * 3600


def _started() -> float:
    marker = Path(__file__).resolve().parents[3] / ".unprompted" / "weekly-started"
    try:
        age = time.time() - float(marker.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        age = 0.0
    # ponytail: a manual run within 8 hours of a weekly start inherits its clock.
    return time.monotonic() - (age if 0 <= age < 8 * 3600 else 0.0)


_PROCESS_STARTED = _started()


def run_time_left() -> float:
    return _PROCESS_STARTED + RUN_SECONDS - time.monotonic()


def wait_deadline(max_wait: float) -> float:
    """When a batch wait started now must give up: `max_wait`, or the run's end."""
    return min(time.monotonic() + max_wait, _PROCESS_STARTED + RUN_SECONDS)


def refuse_new_paid_work(what: str) -> None:
    """Nothing new is paid for once the run's clock is spent: it could not be collected."""
    if run_time_left() <= 0:
        raise TimeoutError(f"{what} not started: the weekly run's {RUN_SECONDS // 3600}-hour budget is spent")


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
    # Does this engine look things up before answering?
    #
    # True for every hosted assistant: across the archive Perplexity and Claude
    # cite sources on 100% of answers and ChatGPT on 95%, and that is the whole
    # premise -- a model answering from memory reports which brands it absorbed
    # in training, not which are findable today.
    #
    # Declared rather than inferred because the check that enforces it has to
    # tell "this engine stopped searching" apart from "this engine never
    # searched", and those look identical in a run record. A Gemini model
    # evaluated on 2026-08-26 answered reliably and chose to search on a fifth
    # of calls, which is invisible on every dashboard and changes what the
    # number means.
    grounds: bool = True
    # Why this engine could not answer, in words that fit how it is configured.
    # Overridden by CliEngine, whose problem is never a missing key.
    unavailable_reason: str = "not configured: no API key present"

    def __init__(self) -> None:
        self.api_key = read_key(*self.key_names)

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    @staticmethod
    def is_retryable(exc: Exception) -> bool:
        """Is this worth trying again, or is it the same answer three times?

        A spend cap, a revoked key and a malformed request do not improve with a
        second attempt. Retrying them costs the run its time budget and, where
        the provider bills rejected calls, its money: on 2026-08-24 every one of
        claude's 75 image-category calls hit an exhausted usage limit and each
        was attempted three times.

        Judged on the exception type name and message rather than a typed status
        code, because four providers with four SDKs raise four class
        hierarchies, and this has to hold for all of them. Unknown failures stay
        retryable: a transient error wrongly treated as permanent loses an
        answer, while a permanent one wrongly retried only wastes time.
        """
        name = type(exc).__name__.lower()
        text = str(exc).lower()

        if any(p in text for p in ("quota", "billing", "credit balance", "usage limit", "spending limit")):
            return False
        # Rate limits are the one 4xx worth waiting out.
        if is_rate_limit(exc):
            return True
        # A typed status where there is one: urllib's HTTPError (Gemini,
        # Perplexity) says only "HTTP Error 400: Bad Request", which no phrase
        # below matches, so a malformed request was tried three times.
        status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        if isinstance(status, int) and 400 <= status < 500 and status != 408:
            return False

        permanent = (
            "authenticationerror", "permissiondeniederror", "notfounderror",
            "badrequesterror", "unprocessableentityerror",
        )
        if name in permanent:
            return False

        return not any(
            phrase in text
            for phrase in (
                "usage limit", "spending limit", "quota", "insufficient_quota",
                "credit balance", "billing", "invalid api key", "invalid_api_key",
                "authentication", "unauthorized", "forbidden",
            )
        )

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        """Return (answer_text, source_urls, usage). May raise; caller handles it."""
        raise NotImplementedError

    def ask_one(self, question_id: str, question: str, run_index: int) -> EngineAnswer:
        """One call, with retries. Never raises.

        A failure after retries becomes an EngineAnswer carrying `error`, which
        is recorded as data. One dead engine must not cost the week.
        """
        if not self.is_configured or getattr(self, "_blocked_error", None):
            return EngineAnswer(
                engine=self.name,
                question_id=question_id,
                question=question,
                run_index=run_index,
                error=getattr(self, "_blocked_error", None) or self.unavailable_reason,
                fetched_at=utc_now(),
            )

        text, sources, usage, error, metadata = "", [], {}, None, None
        for attempt in range(MAX_ATTEMPTS):
            if attempt and run_time_left() <= 0:
                break  # a retry is new paid work too; keep the last error
            try:
                # An adapter may add a fourth item: provider metadata for this call.
                text, sources, usage, *rest = self._one_call(question)
                metadata = rest[0] if rest else None
                error = ("engine failed: incomplete response" if usage.get("incomplete_response")
                         else "engine failed: answered by a different model than the run qualified"
                         if usage.get("served_model_mismatch") else None)
                break
            except Exception as exc:  # noqa: BLE001 - recorded, not raised
                error = f"{type(exc).__name__}: {exc}"
                if any(word in error.lower() for word in ("quota", "billing", "credit balance", "usage limit", "spending limit", "authentication", "unauthorized", "invalid api key", "invalid_api_key")):
                    # In-flight calls may finish; queued calls on this instance stop.
                    self._blocked_error = f"not attempted after provider failure: {error}"
                if not self.is_retryable(exc):
                    break
                if attempt < MAX_ATTEMPTS - 1:
                    # A rate limit needs longer than a reset connection: two and
                    # four seconds just spent the retries inside the same window.
                    pause = RATE_LIMIT_BACKOFF_SECONDS if is_rate_limit(exc) else BACKOFF_SECONDS
                    time.sleep(pause * (attempt + 1))

        return EngineAnswer(
            engine=self.name,
            question_id=question_id,
            question=question,
            run_index=run_index,
            text=text,
            sources=sources,
            error=error,
            fetched_at=utc_now(),
            usage=usage,
            source_kind=getattr(self, "source_kind", "unspecified"),
            metadata=metadata,
        )

    def ask(self, question_id: str, question: str, runs: int) -> list[EngineAnswer]:
        """Sequential convenience wrapper. The orchestrator parallelises instead:
        measured serially, a full week is roughly 2.5 hours of wall clock."""
        return [self.ask_one(question_id, question, i) for i in range(runs)]
