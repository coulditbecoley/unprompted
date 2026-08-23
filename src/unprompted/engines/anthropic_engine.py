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

    def _one_call(self, question: str) -> tuple[str, list[str], dict[str, int]]:
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
        usage = _usage(response)

        if getattr(response, "stop_reason", None) == "refusal":
            return "", [], usage

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

        return "\n".join(text_parts).strip(), sources, usage


def _usage(response: object) -> dict[str, int]:
    """Token counts plus billable server-side searches, read defensively."""
    u = getattr(response, "usage", None)
    if u is None:
        return {}
    out = {
        "input_tokens": int(getattr(u, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(u, "output_tokens", 0) or 0),
    }
    # Web search is billed per search, separately from tokens.
    tool = getattr(u, "server_tool_use", None)
    searches = getattr(tool, "web_search_requests", None) if tool else None
    if searches:
        out["web_searches"] = int(searches)
    return out
