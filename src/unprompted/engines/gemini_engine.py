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
import time
import urllib.request
from urllib.parse import urlparse

from ..cli_provider import ProviderError
from .base import (BACKOFF_SECONDS, MAX_ATTEMPTS, RATE_LIMIT_BACKOFF_SECONDS, SYSTEM_PROMPT, Engine,
                   is_rate_limit, refuse_new_paid_work)

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

# Pinning does not hold on Google's side: from October 2026 requests for
# gemini-3.5-flash are answered by gemini-3.6-flash (`modelVersion`), which
# searches far less on its own. Cited answers fell from about 98% to between
# 12% and 53% per category, and every category was held. In a test on
# 2026-10-29 it searched for 1 of 8 buying questions as asked and 8 of 8 with
# this one sentence added, so Gemini's instruction carries it. Method change:
# recorded in the frozen engine configuration as `prompt_suffix`.
PROMPT_SUFFIX = " Search the web for current information before answering."


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


_SERVED: dict[str, str | ProviderError] = {}


class GeminiEngine(Engine):
    name = "gemini"
    key_names = ("GEMINI_API_KEY", "GOOGLE_API_KEY")
    prompt_suffix = PROMPT_SUFFIX

    def identify(self) -> dict[str, str]:
        """The model Google actually serves for MODEL, from one short call.

        Recorded as this engine's model in the methodology snapshot, so a silent
        re-route (3.5 to 3.6 in October 2026) stops the run before the measured
        calls like any other unversioned model change. Every measured answer is
        then checked against it (`_one_call`). Once per process, failures
        included, so a bad probe is not repeated for every category.
        ponytail: the probe carries the search tool (same request shape as the
        measured calls) but asks for one word, so it does not search; at most 16
        output tokens with minimal thinking, under $0.001. It is refused once the
        month's budget is spent but not itself added to it.
        """
        if MODEL not in _SERVED:
            from datetime import date
            from ..budget import MONTHLY_CEILING, spent_in_month
            if MONTHLY_CEILING > 0 and spent_in_month(date.today()) >= MONTHLY_CEILING:  # 0 = no ceiling
                raise ProviderError("gemini: the month's budget is spent, so not even the model probe runs")
            for attempt in range(MAX_ATTEMPTS):
                refuse_new_paid_work("Gemini model probe")  # before every attempt, retries included
                try:
                    metadata = self._probe()
                    if not metadata.get("modelVersion"):
                        raise ProviderError("gemini: the response did not say which model answered")
                    _SERVED[MODEL] = metadata["modelVersion"]
                    break
                except Exception as exc:  # noqa: BLE001 - reported by the caller as a refusal
                    failure = exc if isinstance(exc, ProviderError) else ProviderError(
                        f"gemini: could not tell which model answers: {type(exc).__name__}: {exc}")
                    if isinstance(exc, ProviderError) or not self.is_retryable(exc):
                        _SERVED[MODEL] = failure  # permanent: not repeated for each category
                        break
                    # A 503 or 429 on Monday morning must not cost the whole week.
                    if attempt < MAX_ATTEMPTS - 1:
                        time.sleep((RATE_LIMIT_BACKOFF_SECONDS if is_rate_limit(exc) else BACKOFF_SECONDS) * (attempt + 1))
            else:
                raise failure  # transient each time: the next category may try again
        if isinstance(_SERVED[MODEL], ProviderError):
            raise _SERVED[MODEL]
        return {"model": _SERVED[MODEL], "version": f"requested {MODEL}"}

    def _probe(self) -> dict:
        """The response's model fields for a tiny, search-free request."""
        payload = json.dumps({
            "contents": [{"role": "user", "parts": [{"text": "Reply with just the word OK."}]}],
            # The measured calls' tool, so the probe is the same request shape
            # Google routes: a model chosen per shape would otherwise fail every
            # measured answer. A one-word reply does not search (billed per search).
            "tools": [{"google_search": {}}],
            "generationConfig": {"maxOutputTokens": 16, "thinkingConfig": {"thinkingLevel": "minimal"}},
        }).encode("utf-8")
        request = urllib.request.Request(ENDPOINT.format(model=MODEL), data=payload, method="POST",
                                         headers={"x-goog-api-key": self.api_key or "", "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
        grounding = ((body.get("candidates") or [{}])[0]).get("groundingMetadata") or {}
        return {**{k: body[k] for k in ("modelVersion",) if k in body},
                "web_searches": len(grounding.get("webSearchQueries") or [])}

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        payload = json.dumps(
            {
                # Gemini takes the system prompt as its own field rather than as
                # a first message, so the shared SYSTEM_PROMPT lands in the same
                # role it does everywhere else.
                "system_instruction": {"parts": [{"text": SYSTEM_PROMPT + self.prompt_suffix}]},
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

        grounding = candidate.get("groundingMetadata") or {}
        sources = _sources(grounding)

        u = body.get("usageMetadata") or {}
        thoughts = int(u.get("thoughtsTokenCount", 0) or 0)
        usage = {
            "input_tokens": int(u.get("promptTokenCount", 0) or 0),
            # Thinking is billed at the output rate and reported apart from the
            # answer. Reuniting them here is the difference between a true cost
            # and one that is roughly half of it.
            "output_tokens": int(u.get("candidatesTokenCount", 0) or 0) + thoughts,
            # Gemini 3 grounding is billed per search query, so an answer that
            # searched five times is five. Older records hold `requests`, one
            # per grounded prompt, and are not repriced.
            "web_searches": len(grounding.get("webSearchQueries") or []),
        }
        # A blocked prompt has no candidate; a truncated or filtered answer ends
        # on something other than STOP. Either is a failed answer, usage kept.
        if not candidates or candidate.get("finishReason", "STOP") != "STOP":
            usage["incomplete_response"] = 1
        # The probe qualified one model; an answer from another is not this row.
        qualified = _SERVED.get(MODEL)
        if isinstance(qualified, str) and body.get("modelVersion") != qualified:
            usage["served_model_mismatch"] = 1

        # Kept verbatim so the 2026-10 drop in search coverage (and the next
        # one) can be diagnosed: absent, null and {} grounding stay distinct.
        # Stored as data and never rendered (it includes Google's widget HTML).
        metadata = {k: body[k] for k in ("modelVersion", "promptFeedback") if k in body}
        metadata |= {k: candidate[k] for k in ("finishReason", "groundingMetadata") if k in candidate}
        return text, sources, usage, metadata
