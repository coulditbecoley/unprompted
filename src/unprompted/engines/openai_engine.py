"""ChatGPT, queried natively through OpenAI's Responses API with web search.

This is the closest an API gets to the consumer product: OpenAI's own retrieval,
OpenAI's own ranking, OpenAI's own citations. It is still not the ChatGPT app,
which METHODOLOGY.md states plainly.
"""

from __future__ import annotations

from .base import SYSTEM_PROMPT, Engine

MODEL = "gpt-5"
WEB_SEARCH_TOOL = {"type": "web_search"}
# A web-search answer runs long, but not this long. Without an explicit cap the
# SDK default plus three retries can hold a worker for the whole job timeout,
# and six wedged workers stall the run behind them. Perplexity already caps at
# 90s; this is the same idea with more headroom for search.
TIMEOUT_SECONDS = 180


class OpenAIEngine(Engine):
    name = "chatgpt"
    key_names = ("OPENAI_API_KEY", "OPENAI_API")

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key, timeout=TIMEOUT_SECONDS, max_retries=0)
        response = client.responses.create(
            model=MODEL,
            instructions=SYSTEM_PROMPT,
            input=question,
            tools=[WEB_SEARCH_TOOL],
        )

        text = (getattr(response, "output_text", "") or "").strip()
        sources = _collect_citations(response)

        u = getattr(response, "usage", None)
        usage = (
            {
                "input_tokens": int(getattr(u, "input_tokens", 0) or 0),
                "output_tokens": int(getattr(u, "output_tokens", 0) or 0),
            }
            if u
            else {}
        )
        # Every call in this category uses the web search tool, and OpenAI bills
        # it per call rather than reporting it in usage.
        usage["web_searches"] = 1
        return text, sources, usage


def _collect_citations(response: object) -> list[str]:
    """Pull url_citation annotations out of the response, tolerantly.

    The annotation shape has moved more than once, so this reads defensively
    rather than assuming a fixed path. A missing citation is not worth losing
    the answer over.
    """
    urls: list[str] = []
    for item in getattr(response, "output", None) or []:
        for block in getattr(item, "content", None) or []:
            for annotation in getattr(block, "annotations", None) or []:
                url = getattr(annotation, "url", None)
                if url is None and isinstance(annotation, dict):
                    url = annotation.get("url")
                if url:
                    urls.append(url)
    # Preserve citation order, drop repeats.
    return list(dict.fromkeys(urls))
