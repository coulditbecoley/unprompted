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
_PAREN = re.compile(r"\s*[(\[][^)\]]*[)\]]")
# Same habit with a dash: "AGS - Automated Grading Systems". Hyphen, en dash and
# em dash all appear in real answers.
_DASH = re.compile(r"\s+[-–—]\s+")
# Trailing corporate noise that never distinguishes one brand from another.
_SUFFIXES = (
    "llc", "inc", "incorporated", "ltd", "limited", "corp", "corporation", "co",
)
# Possessives, before punctuation folding turns the apostrophe into a space and
# leaves a stray "s" welded into the key. Engines write "Google's Gemini" as
# often as "Google Gemini".
_POSSESSIVE = re.compile(r"['\u2019]s\b", re.IGNORECASE)
# A trailing version token. "Flux.2", "Stable Diffusion 3.5", "Seedream 4.5" and
# "GPT Image 2" are the same brand as their unnumbered form, and a chart of
# brands should not gain a new row every time a vendor ships a point release.
#
# Applied only as a last-resort fallback in resolve(), never inside _key(). A
# trailing number is a version in one category and a grade in another: "PSA 10"
# is a grade the exclude list drops on purpose, and folding it in _key() made
# its key "psa", which then excluded the PSA *brand* from its own chart. Exact
# matching therefore always wins, and this is tried only for a name that would
# otherwise be quarantined.
#
# Version words like "pro" or "turbo" are deliberately not stripped at all: they
# are sometimes a tier and sometimes part of the name, and guessing wrong
# silently merges two real products. Those stay explicit aliases.
_VERSION = re.compile(r"^v?\d+(?:[._]\d+)*$")
# Trailing words that describe a tier, a wrapper or the fact that something is
# AI, rather than naming a different company. "Recraft V4 Pro" is Recraft;
# "Google's Gemini app" is Gemini; "ChatGPT Plus" is ChatGPT. METHODOLOGY.md
# already says a tier is not a company, and the extraction prompt asks for the
# same, but engines write them anyway.
#
# Safe only because this runs as a fallback: "Leonardo AI", "Krea AI" and
# "Stability AI" are all exact entries that match before it is ever reached.
_NOISE_WORDS = frozenset(
    {"ai", "app", "apps", "pro", "plus", "max", "ultra", "premium", "edition"}
)


def _key(name: str) -> str:
    """Fold a name to a comparison key: lowercase, punctuation-free, no suffix.

    Possessives go too: engines write "Google's Gemini" as often as "Google
    Gemini", and punctuation folding alone would leave a stray "s" in the key.
    """
    folded = _PUNCT.sub(" ", _POSSESSIVE.sub("", name.strip().lower())).strip()
    parts = [p for p in folded.split() if p]
    while parts and parts[-1] in _SUFFIXES:
        parts.pop()
    return " ".join(parts)


def _without_version(name: str) -> str:
    """The key for `name` with trailing version and tier tokens removed.

    Repeated, so "Recraft V4 Pro" loses both halves and lands on "recraft".
    """
    parts = _key(name).split()
    while len(parts) > 1 and (_VERSION.match(parts[-1]) or parts[-1] in _NOISE_WORDS):
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
        """Known, and deliberately not charted, on an exact reading."""
        if _key(name) in self._excluded:
            return True
        outside = _PAREN.sub("", name)
        return outside != name and _key(outside) in self._excluded

    def is_excluded_loosely(self, name: str) -> bool:
        """Excluded once trailing version and tier words are dropped.

        "ChatGPT Plus" is ChatGPT wearing a subscription tier, and ChatGPT is
        excluded, so it should be dropped rather than quarantined every week.

        Kept separate from is_excluded, and checked only after resolve() has
        failed, because the loose reading can otherwise beat an exact one:
        "Stability AI" is an alias of Stable Diffusion, and folding it to
        "stability" would hit the exclude list and delete a charted brand.
        """
        stripped = _without_version(name)
        return bool(stripped) and stripped != _key(name) and stripped in self._excluded

    def _candidates(self, name: str) -> list[str]:
        """Every reading of `name` worth looking up, best first.

        Engines combine these habits freely, so the readings have to compose:
        "FLUX.1 [schnell]" needs the bracket removed *and* the version dropped,
        and trying each trick only against the original string missed it.
        """
        forms = [name]

        # "Beckett (BGS)" and "FLUX.1 [schnell]" -> the name without the aside,
        # then each thing inside it.
        outside = _PAREN.sub("", name)
        if outside.strip() and outside != name:
            forms.append(outside)
            forms.extend(re.findall(r"[(\[]([^)\]]*)[)\]]", name))

        # "AGS - Automated Grading Systems" -> try each side.
        forms.extend(part for part in _DASH.split(name) if part.strip() and part != name)

        # Exact readings first, every one of them, before any folded reading:
        # a spelling somebody wrote down beats a spelling we inferred.
        keys = [_key(f) for f in forms]
        keys += [_without_version(f) for f in forms]

        seen: set[str] = set()
        return [k for k in keys if k and not (k in seen or seen.add(k))]

    def resolve(self, name: str) -> str | None:
        """Return the canonical name, or None when the name is unknown."""
        for key in self._candidates(name):
            found = self._lookup.get(key)
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
            # Order is load-bearing. An exact exclusion wins outright; then a
            # brand match, exact or folded; then a folded exclusion. Letting the
            # loose exclusion run earlier would drop names that are really
            # charted brands wearing a suffix.
            if aliases.is_excluded(brand.name):
                continue  # known, deliberately not charted
            canonical = aliases.resolve(brand.name)
            if canonical is None:
                if not aliases.is_excluded_loosely(brand.name):
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
