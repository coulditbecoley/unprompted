"""Perplexity, queried through its Agent API with its own Sonar model.

Sonar Chat Completions was retired on 2026-09-27. The Agent API's presets run
OpenAI models, which would measure ChatGPT twice, so the model is pinned to
`perplexity/sonar`. Unlike the old endpoint it does not search unless given
the web_search tool: without it, a probe named DALL-E from memory.
"""

from __future__ import annotations

import json
import urllib.request

from .base import SYSTEM_PROMPT, Engine

ENDPOINT = "https://api.perplexity.ai/v1/agent"
MODEL = "perplexity/sonar"
TIMEOUT_SECONDS = 90


class PerplexityEngine(Engine):
    name = "perplexity"
    key_names = ("PERPLEXITY_API_KEY", "PERPLEXITY_API")

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        payload = json.dumps(
            {
                "model": MODEL,
                "instructions": SYSTEM_PROMPT,
                "input": question,
                "tools": [{"type": "web_search"}],
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
        return read_response(body)


def read_response(body: dict) -> tuple[str, list[str], dict[str, int]]:
    text_parts: list[str] = []
    sources: list[str] = []
    for item in body.get("output") or []:
        if item.get("type") == "message":
            for block in item.get("content") or []:
                if block.get("type") == "output_text" and block.get("text"):
                    text_parts.append(block["text"])
                for ann in block.get("annotations") or []:
                    if isinstance(ann, dict) and ann.get("url"):
                        sources.append(ann["url"])
        elif item.get("type") == "search_results":
            for result in item.get("results") or []:
                if isinstance(result, dict) and result.get("url"):
                    sources.append(result["url"])

    u = body.get("usage") or {}
    searches = ((u.get("tool_calls_details") or {}).get("search_web") or {}).get("invocation", 0)
    # Cache writes are part of input_tokens and billed at the input rate, so
    # input_tokens alone prices them. Cache reads are left at full input
    # price: a small overestimate rather than a second multiplier.
    usage = {
        "input_tokens": int(u.get("input_tokens", 0) or 0),
        "output_tokens": int(u.get("output_tokens", 0) or 0),
        "web_searches": int(searches or 0),
    }
    if body.get("status") not in {None, "completed"}:
        usage["incomplete_response"] = 1
    return "\n".join(text_parts).strip(), list(dict.fromkeys(sources)), usage
