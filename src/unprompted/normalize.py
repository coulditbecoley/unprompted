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
# Engines habitually write "Beckett (BGS)" or "PSA (Professional Sports
# Authenticator)". Both halves are usually already known, so try the name with
# the parenthetical removed before giving up and quarantining it.
_PAREN = re.compile(r"\s*\([^)]*\)")
# Same habit with a dash: "AGS - Automated Grading Systems". Hyphen, en dash and
# em dash all appear in real answers.
_DASH = re.compile(r"\s+[-–—]\s+")
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
    """Maps every known spelling of a brand to one canonical name.

    Three outcomes, and the third is why the chart can ever publish:
      known      -> canonical name, charted
      excluded   -> dropped silently (a real thing, but not in this category)
      unknown    -> quarantined, held for a human

    Without the excluded bucket, marketplaces and grade labels would trip the
    quarantine check every week forever.
    """

    def __init__(self, canonical: dict[str, list[str]], exclude: list[str] | None = None):
        self._lookup: dict[str, str] = {}
        self._excluded: set[str] = {_key(x) for x in (exclude or [])}
        self.canonical_names: list[str] = sorted(canonical)
        for name, aliases in canonical.items():
            self._lookup[_key(name)] = name
            for alias in aliases or []:
                self._lookup[_key(alias)] = name

    @classmethod
    def load(cls, path: str | Path) -> "AliasMap":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        return cls(data.get("canonical", {}), data.get("exclude", []))

    def is_excluded(self, name: str) -> bool:
        """Known, and deliberately not charted."""
        if _key(name) in self._excluded:
            return True
        outside = _PAREN.sub("", name)
        return outside != name and _key(outside) in self._excluded

    def resolve(self, name: str) -> str | None:
        """Return the canonical name, or None when the name is unknown."""
        direct = self._lookup.get(_key(name))
        if direct is not None:
            return direct

        # "Beckett (BGS)" -> try "Beckett", then try "BGS".
        outside = _PAREN.sub("", name)
        if outside != name:
            found = self._lookup.get(_key(outside))
            if found is not None:
                return found
            inside = re.findall(r"\(([^)]*)\)", name)
            for part in inside:
                found = self._lookup.get(_key(part))
                if found is not None:
                    return found

        # "AGS - Automated Grading Systems" -> try each side.
        for part in _DASH.split(name):
            if part.strip() and part != name:
                found = self._lookup.get(_key(part))
                if found is not None:
                    return found
        return None


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
            if aliases.is_excluded(brand.name):
                continue  # known, deliberately not charted
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
