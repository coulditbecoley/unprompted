"""Gemini, queried natively with Google Search grounding.

Grounding is not optional here. The other three engines all search before they
answer, and that is what makes a week one measurement rather than three: a model
answering from training data is reporting what it memorised, not what a shopper
would be told today. A Gemini without `google_search` would look like an engine
and quietly measure something else.

Two things about this API surprised a dry run, and both would have been silent:

Sources come back as Google redirect URLs, not as the pages themselves. The
publication counts source *domains*, so storing those verbatim would have made
`vertexaisearch.cloud.google.com` the most-cited domain on the site by a wide
margin, and it would have looked plausible. The real domain is in the chunk's
`title`; see `_sources`.

Thinking tokens are billed as output and are reported separately. On the test
call, 879 answer tokens came with 853 thinking tokens, so counting only
`candidatesTokenCount` would have under-reported Gemini's cost by roughly half
-- on a dashboard whose entire purpose is to say what a week cost.
"""

from __future__ import annotations

import json
import urllib.request
from urllib.parse import urlparse

from .base import SYSTEM_PROMPT, Engine

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Pinned, and deliberately not an alias.
#
# `gemini-pro-latest` and friends re-point without notice, which would change
# what the series measures between two Mondays with nothing in the archive to
# show for it. Preview models are excluded for the same reason plus one more:
# they are withdrawn. `gemini-2.5-pro` was the obvious flagship choice and is
# already refused for new keys -- "no longer available to new users" -- which is
# exactly the failure a published weekly series cannot absorb.
#
# Changing this is a method change and needs a method_version bump, like adding
# an engine.
MODEL = "gemini-3.5-flash"
TIMEOUT_SECONDS = 120


def _sources(grounding: dict) -> list[str]:
    """Real domains from grounding chunks, not Google's redirector.

    Every `uri` here points at vertexaisearch.cloud.google.com, so the domain a
    reader cares about survives only in `title`, which for web results is the
    bare host. Reconstructed into a URL because that is what the rest of the
    pipeline stores and `source_counts` parses.

    A title that is not host-shaped is a page title rather than a domain, and
    the redirect is kept in that case: opaque is worse than nothing, but losing
    the citation entirely is worse still.
    """
    out: list[str] = []
    for chunk in grounding.get("groundingChunks") or []:
        web = chunk.get("web") or {}
        uri = (web.get("uri") or "").strip()
        title = (web.get("title") or "").strip().lower()

        # Newer responses sometimes carry the domain outright; prefer it.
        domain = (web.get("domain") or "").strip().lower()
        if not domain and title and " " not in title and "." in title:
            domain = title

        if domain:
            host = domain.removeprefix("www.")
            if not urlparse(f"https://{host}").netloc:
                continue
            out.append(f"https://{host}")
        elif uri:
            out.append(uri)

    return list(dict.fromkeys(out))


class GeminiEngine(Engine):
    name = "gemini"
    key_names = ("GEMINI_API_KEY", "GOOGLE_API_KEY")

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        payload = json.dumps(
            {
                # Gemini takes the system prompt as its own field rather than as
                # a first message, so the shared SYSTEM_PROMPT lands in the same
                # role it does everywhere else.
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": question}]}],
                "tools": [{"google_search": {}}],
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            ENDPOINT.format(model=MODEL),
            data=payload,
            headers={
                # The key goes in a header rather than the query string: a URL
                # carrying a secret ends up in logs, proxies and error messages.
                "x-goog-api-key": self.api_key or "",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))

        candidates = body.get("candidates") or []
        candidate = candidates[0] if candidates else {}

        parts = (candidate.get("content") or {}).get("parts") or []
        # Thinking parts carry `thought: true` and are not the answer. Joining
        # everything would publish the model's reasoning as its recommendation.
        text = "".join(
            p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought")
        ).strip()

        sources = _sources(candidate.get("groundingMetadata") or {})

        u = body.get("usageMetadata") or {}
        thoughts = int(u.get("thoughtsTokenCount", 0) or 0)
        usage = {
            "input_tokens": int(u.get("promptTokenCount", 0) or 0),
            # Thinking is billed at the output rate and reported apart from the
            # answer. Reuniting them here is the difference between a true cost
            # and one that is roughly half of it.
            "output_tokens": int(u.get("candidatesTokenCount", 0) or 0) + thoughts,
            # Search grounding is billed per grounded prompt, not per query, so
            # a call that searched five times is still one billable request.
            "requests": 1 if sources or (candidate.get("groundingMetadata") or {}) else 0,
        }
        return text, sources, usage
