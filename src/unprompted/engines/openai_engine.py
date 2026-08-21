"""ChatGPT, queried natively through OpenAI's Responses API with web search.

This is the closest an API gets to the consumer product: OpenAI's own retrieval,
OpenAI's own ranking, OpenAI's own citations. It is still not the ChatGPT app,
which METHODOLOGY.md states plainly.
"""

from __future__ import annotations

from .base import SYSTEM_PROMPT, Engine

MODEL = "gpt-5"
WEB_SEARCH_TOOL = {"type": "web_search"}


class OpenAIEngine(Engine):
    name = "chatgpt"
    key_names = ("OPENAI_API_KEY",)

    def _one_call(self, question: str) -> tuple[str, list[str]]:
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key)
        response = client.responses.create(
            model=MODEL,
            instructions=SYSTEM_PROMPT,
            input=question,
            tools=[WEB_SEARCH_TOOL],
        )

        text = (getattr(response, "output_text", "") or "").strip()
        sources = _collect_citations(response)
        return text, sources


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
