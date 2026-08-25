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
    # Token counts as reported by the provider, plus any billable server-side
    # searches. Measured rather than estimated: "what does a category cost" is
    # a question the data should answer, not one we guess at.
    usage: dict[str, int] = field(default_factory=dict)

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
    usage: dict[str, int] = field(default_factory=dict)
    # The engine's verbatim answer. Stored because the methodology promises every
    # raw answer is public, and because a failed extraction should cost a cheap
    # re-parse rather than re-querying every engine.
    answer: str = ""
    # When the engine was actually asked. EngineAnswer has carried this from the
    # start and the extraction step dropped it, so a stored run could say which
    # week it belonged to but not when any answer in it was fetched. That is the
    # difference between "measured on Monday" and "re-read on Wednesday".
    fetched_at: str = ""

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
            "usage": self.usage,
            "fetched_at": self.fetched_at,
        }


@dataclass
class RunRecord:
    """One complete weekly run. Written once, never edited."""

    category: str
    run_date: str
    method_version: int
    runs_per_question: int
    engines: list[str]
    # Which reader turned the answers into structured data: a provider id from
    # providers.json, or "api" for the hosted extractor. Recorded because more
    # than one local harness can be registered and the pipeline falls through to
    # the next one that resolves, so "who read this week" is not a constant and
    # is not recoverable from anywhere else in the record.
    extractor: str = "api"
    # The model that did the reading, when the extractor was the hosted API.
    # "api" alone does not say which model, and the answer to "why did the
    # numbers move" is often "a different model read them".
    extractor_model: str = ""
    # The date the engines were actually queried. Normally the same as run_date.
    # A re-extraction re-reads stored answers and writes a file dated today, so
    # without this the archive says engines were asked on a day they were not,
    # and week-over-week movement compares a re-read against a real week.
    measured_on: str = ""
    # For a re-extraction: the run this was read from, as "<date>/<category>".
    # Empty for a run that queried engines itself.
    source_run: str = ""
    # The commit the pipeline ran from. Questions, aliases and prompts all live
    # in the repository, so this is what makes a published week reproducible:
    # without it, "which same-day commit was this" has no answer.
    git_sha: str = ""
    extractions: list[Extraction] = field(default_factory=list)
    quarantined: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "run_date": self.run_date,
            "method_version": self.method_version,
            "runs_per_question": self.runs_per_question,
            "engines": self.engines,
            "extractor": self.extractor,
            "extractor_model": self.extractor_model,
            "measured_on": self.measured_on or self.run_date,
            "source_run": self.source_run,
            "git_sha": self.git_sha,
            "extractions": [e.to_dict() for e in self.extractions],
            # Sorted, not deduplicated. checks.py counts occurrences to decide
            # whether an unrecognised name is material enough to hold the week,
            # and the admin dashboard sorts triage by the same count. Collapsing
            # to a set here capped every count at 1, so the frequency check
            # could never fire.
            "quarantined": sorted(self.quarantined),
        }
