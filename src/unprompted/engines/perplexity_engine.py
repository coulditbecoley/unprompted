"""Perplexity, queried natively through the Sonar API.

Sonar carries its own retrieval rather than having search bolted on, so its
answers reflect Perplexity's ranking rather than a third party's index.
"""

from __future__ import annotations

import json
import urllib.request

from .base import SYSTEM_PROMPT, Engine

ENDPOINT = "https://api.perplexity.ai/chat/completions"
MODEL = "sonar"
TIMEOUT_SECONDS = 90


class PerplexityEngine(Engine):
    name = "perplexity"
    key_names = ("PERPLEXITY_API_KEY",)

    def _one_call(self, question: str) -> tuple[str, list[str]]:
        payload = json.dumps(
            {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": question},
                ],
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            ENDPOINT,
            data=payload,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))

        text = ""
        choices = body.get("choices") or []
        if choices:
            text = (choices[0].get("message", {}).get("content") or "").strip()

        # Sonar has returned citations under two different keys across versions;
        # accept either rather than silently losing the sources.
        raw = body.get("citations") or body.get("search_results") or []
        sources: list[str] = []
        for entry in raw:
            if isinstance(entry, str):
                sources.append(entry)
            elif isinstance(entry, dict) and entry.get("url"):
                sources.append(entry["url"])

        return text, list(dict.fromkeys(sources))
