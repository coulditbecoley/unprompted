"""Read a prose answer and return structured data.

An AI reading an AI. Pattern matching is not an option here: the engines write
ordinary prose, and brand names appear inline, possessively, abbreviated and
inside comparisons. A forced JSON schema makes parse failures impossible.

ponytail: these are live calls, not the Batch API. Batch halves the cost but
adds a polling loop and its own failure modes, and 225 small calls a week does
not justify that yet. Switch when a run gets big enough to notice.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .models import BrandMention, EngineAnswer, Extraction

MODEL = "claude-opus-5"
MAX_TOKENS = 2048

EXTRACT_PROMPT = """\
Below is an answer an AI assistant gave to a shopper's question.

List every company or brand it names as an option the shopper could use, in the \
order they first appear in the answer. Position 1 is the first one named.

Rules:
- Only companies the answer presents as options. Ignore companies mentioned \
purely as context, as an aside, or as something to avoid.
- Use the name exactly as the answer writes it. Do not expand or correct it.
- One company per entry. If the answer writes several together, such as \
"SGC/TAG/Ace" or "TAG and AGS", list them as separate entries in the order they \
appear.
- Do not list grades, tiers or service levels as companies. "PSA 10", \
"BGS Pristine 10", "Black Label" and "Bulk" are outcomes or service tiers, not \
companies. If the answer says "a PSA 10", the company is PSA.
- If the answer declines to recommend anything, or names no companies at all, \
set refused to true and return an empty brand list.
- sentiment is how the answer treats that company: positive, neutral, or negative.

ANSWER:
{answer}
"""


class _Brand(BaseModel):
    name: str = Field(description="Company name exactly as written in the answer")
    position: int = Field(description="1-based order of first appearance")
    sentiment: str = Field(default="neutral", description="positive, neutral, or negative")


class _Extraction(BaseModel):
    brands: list[_Brand]
    refused: bool = Field(description="True if the answer recommended nothing")


def extract_one(answer: EngineAnswer, api_key: str | None = None) -> Extraction:
    """Structure one answer. Never raises: failures become `error` on the record."""
    base = Extraction(
        engine=answer.engine,
        question_id=answer.question_id,
        run_index=answer.run_index,
        sources=answer.sources,
        answer=answer.text,
        # The engine's own usage rides along on the record it produced. Without
        # this the cost report reads $0.00 for every run, which is worse than no
        # report at all: it says the publication is free.
        usage=dict(answer.usage),
    )

    # An engine failure upstream stays a failure; do not spend a call on it.
    if answer.error:
        base.error = answer.error
        return base

    # An empty answer is a refusal, not an error. Engines that decline produce
    # nothing, and how often they decline is worth knowing.
    if not answer.text.strip():
        base.refused = True
        return base

    try:
        from anthropic import Anthropic

        client = Anthropic(api_key=api_key) if api_key else Anthropic()
        result = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            output_config={"effort": "low"},
            messages=[
                {"role": "user", "content": EXTRACT_PROMPT.format(answer=answer.text)}
            ],
            output_format=_Extraction,
        )
        parsed = result.parsed_output

        # The extraction pass is billed too. Kept under its own key so a change
        # in extractor cost never hides inside an engine's line item.
        u = getattr(result, "usage", None)
        if u is not None:
            base.usage["extract_input_tokens"] = getattr(u, "input_tokens", 0) or 0
            base.usage["extract_output_tokens"] = getattr(u, "output_tokens", 0) or 0
    except Exception as exc:  # noqa: BLE001 - recorded, not raised
        base.error = f"extract failed: {type(exc).__name__}: {exc}"
        return base

    base.refused = parsed.refused
    base.brands = [
        BrandMention(name=b.name, position=b.position, sentiment=b.sentiment)
        for b in sorted(parsed.brands, key=lambda b: b.position)
    ]
    return base


def extract_all(answers: list[EngineAnswer], api_key: str | None = None) -> list[Extraction]:
    return [extract_one(a, api_key=api_key) for a in answers]
