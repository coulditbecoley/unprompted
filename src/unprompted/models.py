"""Shared record types for the Unprompted pipeline.

These are the only shapes that cross module boundaries. Keeping them here means
the engines, the extractor and the aggregator can be reasoned about one at a
time.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class EngineAnswer:
    """One raw answer from one engine for one question on one run.

    An engine failure is a *value*, not an exception: `error` is set and `text`
    is empty. One dead engine must never cost the week.
    """

    engine: str
    question_id: str
    question: str
    run_index: int
    text: str = ""
    sources: list[str] = field(default_factory=list)
    error: str | None = None
    fetched_at: str = ""

    @property
    def ok(self) -> bool:
        return self.error is None and bool(self.text.strip())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BrandMention:
    """A single brand named in a single answer. `position` is 1-based."""

    name: str
    position: int
    sentiment: str = "neutral"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Extraction:
    """The structured reading of one EngineAnswer."""

    engine: str
    question_id: str
    run_index: int
    brands: list[BrandMention] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    refused: bool = False
    error: str | None = None
    # The engine's verbatim answer. Stored because the methodology promises every
    # raw answer is public, and because a failed extraction should cost a cheap
    # re-parse rather than re-querying every engine.
    answer: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "question_id": self.question_id,
            "run_index": self.run_index,
            "brands": [b.to_dict() for b in self.brands],
            "sources": self.sources,
            "refused": self.refused,
            "error": self.error,
            "answer": self.answer,
        }


@dataclass
class RunRecord:
    """One complete weekly run. Written once, never edited."""

    category: str
    run_date: str
    method_version: int
    runs_per_question: int
    engines: list[str]
    extractions: list[Extraction] = field(default_factory=list)
    quarantined: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "run_date": self.run_date,
            "method_version": self.method_version,
            "runs_per_question": self.runs_per_question,
            "engines": self.engines,
            "extractions": [e.to_dict() for e in self.extractions],
            "quarantined": sorted(set(self.quarantined)),
        }
