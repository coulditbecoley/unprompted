"""Read a prose answer and return structured data.

An AI reading an AI. Pattern matching is not an option here: the engines write
ordinary prose, and brand names appear inline, possessively, abbreviated and
inside comparisons. A forced JSON schema makes parse failures impossible.

The weekly run goes through the Batch API: half price, and a reading job that
publishes on Mondays does not care that results take minutes instead of
seconds. `extract_one` stays for re-reads of a handful of answers, where
waiting on a batch is the slower path.

Model choice is measured, not assumed. Against 150 stored answers from
published runs, re-read and put through the same normalize():

    model      first brand   brand set   set overlap   $/1k extractions
    Opus 5        89%          77%          91%           $14.10
    Sonnet 5      86%          63%          85%           $ 8.50
    Haiku 4.5     86%          64%          86%           $ 2.10

Opus disagrees with the archive 11% of the time by itself, so that is the
task's noise floor rather than a model failure. Haiku holds the first brand,
which is what the board ranks on, but drops 13 points on the full brand set,
which is what the "named" counts are built from. Sonnet reads no better than
Haiku and costs four times as much, so it is not a middle option. The saving
from Haiku is about $6 a week and it is paid for in lost mentions, so this
stays on Opus.
"""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from pydantic import BaseModel, Field

from .cli_provider import CliProvider, ProviderError, cli_extractor, parse_json_reply
from .models import BrandMention, EngineAnswer, Extraction

MODEL = "claude-opus-5"
MAX_TOKENS = 2048
# The CLI path is capped in cli_provider; cap the API path too, so one hung
# extraction cannot hold a worker for the length of the job.
TIMEOUT_SECONDS = 120

# A batch of a few hundred short reads has finished in minutes every time it has
# been run. The cap is a stop, not an expectation: the weekly task is allowed
# eight hours, so a batch still going after two has gone wrong and should say so
# rather than sit there until the scheduler kills the whole run.
BATCH_POLL_SECONDS = 15
BATCH_MAX_WAIT_SECONDS = 2 * 3600

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


# The CLI path has no schema enforcement, so the shape is asked for in words.
JSON_SUFFIX = """

Reply with one JSON object and nothing else, in exactly this shape:
{"refused": false, "brands": [{"name": "Example", "position": 1, "sentiment": "positive"}]}
"""


def _effort(model: str) -> dict:
    """Low effort suits a mechanical read, but Haiku has no effort control and
    returns a hard 400 if you pass one."""
    return {} if "haiku" in model else {"output_config": {"effort": "low"}}


class _Brand(BaseModel):
    name: str = Field(description="Company name exactly as written in the answer")
    position: int = Field(description="1-based order of first appearance")
    sentiment: str = Field(default="neutral", description="positive, neutral, or negative")


class _Extraction(BaseModel):
    brands: list[_Brand]
    refused: bool = Field(description="True if the answer recommended nothing")


def _base_for(answer: EngineAnswer) -> tuple[Extraction, bool]:
    """The record every path starts from, and whether it still needs a call.

    Shared so the live path and the batch path agree on what counts as an error
    and what counts as a refusal. They disagreed once, and a batch that quietly
    spent a request on an answer the live path skipped is exactly the kind of
    difference that does not show up until the bill does.
    """
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
        return base, False

    # An empty answer is a refusal, not an error. Engines that decline produce
    # nothing, and how often they decline is worth knowing.
    if not answer.text.strip():
        base.refused = True
        return base, False

    return base, True


def extract_one(
    answer: EngineAnswer,
    api_key: str | None = None,
    provider: CliProvider | None = None,
) -> Extraction:
    """Structure one answer with a live call. Never raises: failures become
    `error` on the record.

    `provider` routes the read through a local CLI instead of the API. Resolved
    once by the caller rather than per call, so a 225-answer run does not read
    the registry 225 times.
    """
    base, needed = _base_for(answer)
    if not needed:
        return base

    if provider is not None:
        return _extract_via_cli(base, answer, provider)

    try:
        from anthropic import Anthropic

        client = (
            Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS)
            if api_key
            else Anthropic(timeout=TIMEOUT_SECONDS)
        )
        result = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            **_effort(MODEL),
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


def _extract_via_cli(
    base: Extraction, answer: EngineAnswer, provider: CliProvider
) -> Extraction:
    """Same job through a local CLI. Costs nothing per call and needs no key."""
    try:
        reply = provider.ask(EXTRACT_PROMPT.format(answer=answer.text) + JSON_SUFFIX)
        parsed = parse_json_reply(reply)
    except ProviderError as exc:
        # A harness can fail after doing the job: a failing SessionEnd hook
        # exits non-zero with the answer already printed. Only a complete JSON
        # object is accepted, so a genuinely broken call still fails; a finished
        # one is not thrown away over its exit code.
        try:
            parsed = parse_json_reply(exc.stdout)
        except ProviderError:
            base.error = f"extract failed: {exc}"
            return base
    except Exception as exc:  # noqa: BLE001 - recorded, not raised
        base.error = f"extract failed: {type(exc).__name__}: {exc}"
        return base

    return _apply(base, parsed)


def _apply(base: Extraction, parsed: dict) -> Extraction:
    """Fill a record from an untyped JSON reply, defensively.

    The CLI path has no schema enforcement at all, and the batch path returns
    schema-shaped text that still has to be json.loads'd, so both arrive here as
    a plain dict. A malformed entry is dropped rather than raised: one unreadable
    brand should cost that brand, not the whole answer.
    """
    base.refused = bool(parsed.get("refused"))
    brands = parsed.get("brands")
    if not isinstance(brands, list):
        brands = []

    mentions: list[BrandMention] = []
    for item in brands:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        try:
            position = int(item.get("position", len(mentions) + 1))
        except (TypeError, ValueError):
            position = len(mentions) + 1
        sentiment = str(item.get("sentiment", "neutral")).strip().lower()
        if sentiment not in {"positive", "neutral", "negative"}:
            sentiment = "neutral"
        mentions.append(BrandMention(name=name, position=position, sentiment=sentiment))

    base.brands = sorted(mentions, key=lambda b: b.position)
    # A reply that returned nothing at all is a refusal only if it said so.
    return base


def _client(api_key: str | None):
    from anthropic import Anthropic

    return (
        Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS)
        if api_key
        else Anthropic(timeout=TIMEOUT_SECONDS)
    )


def _json_format() -> dict:
    """The output schema, in the shape the raw Messages API wants.

    `client.messages.parse()` builds this from the pydantic model for us, but
    the Batch API takes raw message params and has no parse() equivalent, so the
    same conversion has to happen here.

    ponytail: transform_schema is a private SDK helper. It is the one the parse()
    helper itself calls, so it cannot drift from what the API accepts without
    parse() breaking too; if the import ever fails, the fix is to inline the
    pydantic schema and add "format": "text" to every string property.
    """
    from anthropic.lib._parse._transform import transform_schema

    return {"type": "json_schema", "schema": transform_schema(_Extraction)}


def extract_all_batch(
    answers: list[EngineAnswer], api_key: str | None = None
) -> list[Extraction]:
    """Structure a whole run in one Batch API job. Half the price of live calls.

    Returns records in the order given. Never raises for a single bad answer;
    a failure lands on that record as `error`, the same as every other path.
    A failure of the *batch* does raise, because a run that silently extracted
    nothing would publish an empty week.
    """
    bases: list[Extraction] = []
    requests = []
    for i, answer in enumerate(answers):
        base, needed = _base_for(answer)
        bases.append(base)
        if not needed:
            continue
        requests.append(
            {
                "custom_id": f"x{i}",
                "params": {
                    "model": MODEL,
                    "max_tokens": MAX_TOKENS,
                    "output_config": {
                        **_effort(MODEL).get("output_config", {}),
                        "format": _json_format(),
                    },
                    "messages": [
                        {
                            "role": "user",
                            "content": EXTRACT_PROMPT.format(answer=answer.text),
                        }
                    ],
                },
            }
        )

    if not requests:
        return bases

    client = _client(api_key)
    batch = client.messages.batches.create(requests=requests)
    print(
        f"  batch {batch.id}: {len(requests)} answers submitted",
        file=sys.stderr,
        flush=True,
    )

    waited = 0
    while batch.processing_status != "ended":
        if waited >= BATCH_MAX_WAIT_SECONDS:
            raise RuntimeError(
                f"batch {batch.id} still {batch.processing_status} after "
                f"{waited // 60} minutes; results are retrievable for 29 days, "
                f"re-read them with reextract rather than re-querying the engines"
            )
        time.sleep(BATCH_POLL_SECONDS)
        waited += BATCH_POLL_SECONDS
        batch = client.messages.batches.retrieve(batch.id)
        if waited % 60 == 0:
            c = batch.request_counts
            print(
                f"  batch {batch.id}: {c.succeeded} done, {c.processing} left"
                f" ({waited // 60}m)",
                file=sys.stderr,
                flush=True,
            )

    seen = set()
    for entry in client.messages.batches.results(batch.id):
        index = int(entry.custom_id[1:])
        seen.add(index)
        base = bases[index]
        if entry.result.type != "succeeded":
            base.error = f"extract failed: batch {entry.result.type}"
            continue
        message = entry.result.message
        try:
            _apply(base, json.loads(message.content[0].text))
        except (ValueError, IndexError, AttributeError) as exc:
            base.error = f"extract failed: {type(exc).__name__}: {exc}"
            continue
        u = getattr(message, "usage", None)
        if u is not None:
            base.usage["extract_input_tokens"] = getattr(u, "input_tokens", 0) or 0
            base.usage["extract_output_tokens"] = getattr(u, "output_tokens", 0) or 0

    # Results come back unordered and, in principle, incomplete. An answer that
    # was submitted and never came back must not read as a clean refusal.
    for request in requests:
        index = int(request["custom_id"][1:])
        if index not in seen:
            bases[index].error = "extract failed: no result returned for this answer"

    return bases


def extract_run(
    answers: list[EngineAnswer],
    provider: CliProvider | None,
    api_key: str | None = None,
    max_workers: int = 6,
) -> list[Extraction]:
    """Read a whole run's answers with whichever extractor the registry chose.

    One function so the live run and a re-extraction cannot drift apart on which
    path they take; that difference is invisible in the output and shows up
    weeks later as an unexplained change in the numbers.

    No provider means the hosted API, and a whole run goes as one batch. A CLI
    provider has no batch equivalent, so those stay concurrent live calls.
    """
    if provider is None:
        print(
            f"  extracting {len(answers)} answers via the Batch API ({MODEL})",
            file=sys.stderr,
            flush=True,
        )
        out = extract_all_batch(answers, api_key=api_key)
        failed = sum(1 for e in out if e.error)
        print(f"  extracted {len(out)} ({failed} failed)", file=sys.stderr, flush=True)
        return out

    print(
        f"  extracting {len(answers)} answers via {provider.label}",
        file=sys.stderr,
        flush=True,
    )
    out = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(extract_one, a, api_key, provider) for a in answers]
        for done, future in enumerate(as_completed(futures), start=1):
            out.append(future.result())
            if done % 25 == 0 or done == len(futures):
                failed = sum(1 for e in out if e.error)
                print(
                    f"  extracted {done}/{len(futures)} ({failed} failed)",
                    file=sys.stderr,
                    flush=True,
                )
    return out


def extract_all(
    answers: list[EngineAnswer],
    api_key: str | None = None,
    provider: CliProvider | None = None,
) -> list[Extraction]:
    if provider is None:
        provider = cli_extractor()
    return [extract_one(a, api_key=api_key, provider=provider) for a in answers]
