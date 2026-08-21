"""Brand-name canonicalisation and the quarantine gate.

This is the safety valve of the whole pipeline. A name the alias map does not
recognise never reaches the chart; it goes to quarantine for a human to look at.
A hallucinated brand should cost five minutes, not credibility.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from .models import Extraction

_PUNCT = re.compile(r"[^a-z0-9]+")
# Trailing corporate noise that never distinguishes one brand from another.
_SUFFIXES = (
    "llc", "inc", "incorporated", "ltd", "limited", "corp", "corporation", "co",
)


def _key(name: str) -> str:
    """Fold a name to a comparison key: lowercase, punctuation-free, no suffix."""
    folded = _PUNCT.sub(" ", name.strip().lower()).strip()
    parts = [p for p in folded.split() if p]
    while parts and parts[-1] in _SUFFIXES:
        parts.pop()
    return " ".join(parts)


class AliasMap:
    """Maps every known spelling of a brand to one canonical name."""

    def __init__(self, canonical: dict[str, list[str]]):
        self._lookup: dict[str, str] = {}
        self.canonical_names: list[str] = sorted(canonical)
        for name, aliases in canonical.items():
            self._lookup[_key(name)] = name
            for alias in aliases or []:
                self._lookup[_key(alias)] = name

    @classmethod
    def load(cls, path: str | Path) -> "AliasMap":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        return cls(data.get("canonical", {}))

    def resolve(self, name: str) -> str | None:
        """Return the canonical name, or None when the name is unknown."""
        return self._lookup.get(_key(name))


def normalize(
    extractions: list[Extraction], aliases: AliasMap
) -> tuple[list[Extraction], list[str]]:
    """Canonicalise brand names and strip anything unrecognised.

    Returns the cleaned extractions and the list of quarantined raw names.

    Positions are renumbered after unknown names are removed, so a chart never
    shows a rank that skips a slot. Duplicate mentions of one brand inside a
    single answer collapse to its earliest position.
    """
    quarantined: list[str] = []
    cleaned: list[Extraction] = []

    for ex in extractions:
        kept = []
        seen: set[str] = set()
        for brand in sorted(ex.brands, key=lambda b: b.position):
            canonical = aliases.resolve(brand.name)
            if canonical is None:
                quarantined.append(brand.name.strip())
                continue
            if canonical in seen:
                continue
            seen.add(canonical)
            kept.append(brand)
            brand.name = canonical

        for new_position, brand in enumerate(kept, start=1):
            brand.position = new_position

        ex.brands = kept
        cleaned.append(ex)

    return cleaned, quarantined
