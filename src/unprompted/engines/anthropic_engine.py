"""Claude, queried natively with Anthropic's own web search tool."""

from __future__ import annotations

from .base import SYSTEM_PROMPT, Engine

MODEL = "claude-opus-5"
MAX_TOKENS = 4096
# Dynamic-filtering web search. Requires Opus 5 / 4.8 / 4.7 / 4.6 or Sonnet 5/4.6.
WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 4}


class AnthropicEngine(Engine):
    name = "claude"
    # CLAUDE_API accepted as an alias: it is a natural name to reach for.
    key_names = ("ANTHROPIC_API_KEY", "CLAUDE_API")

    def _one_call(self, question: str) -> tuple[str, list[str]]:
        from anthropic import Anthropic

        client = Anthropic(api_key=self.api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=[WEB_SEARCH_TOOL],
            messages=[{"role": "user", "content": question}],
        )

        # A refusal is a real outcome, not an error. Surface it as empty text so
        # the extractor records it rather than the pipeline retrying blindly.
        if getattr(response, "stop_reason", None) == "refusal":
            return "", []

        text_parts: list[str] = []
        sources: list[str] = []

        for block in response.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.text)
            elif btype == "web_search_tool_result":
                # On error, `content` is a single object rather than a list.
                # Branch on that before indexing.
                content = getattr(block, "content", None)
                if isinstance(content, list):
                    for result in content:
                        url = getattr(result, "url", None)
                        if url:
                            sources.append(url)

        return "\n".join(text_parts).strip(), sources
