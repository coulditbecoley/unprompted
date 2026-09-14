"""Durable Claude engine batches; never resubmit an ambiguous paid request."""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from .anthropic_engine import request_params, read_response, TIMEOUT_SECONDS
from .base import utc_now
from ..models import EngineAnswer
from ..storage import write_json

POLL_SECONDS = 15
MAX_WAIT_SECONDS = 3600


def _client(api_key):
    from anthropic import Anthropic
    # A timed-out POST may already have created a billable batch.
    return Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=0)


def collect(state_path: Path, api_key: str) -> list[EngineAnswer]:
    """Retrieve an existing job only. Safe to repeat after an interrupted download."""
    from anthropic.types import Message

    state = json.loads(state_path.read_text(encoding="utf-8"))
    expected = {request["custom_id"]: request for request in state["requests"]}
    if len(expected) != len(state["requests"]) or set(expected) != set(state["answers"]):
        raise ValueError("invalid Claude batch checkpoint identities")
    for key, identity in state["answers"].items():
        if (identity.get("engine") != "claude"
            or not re.fullmatch(r"[a-zA-Z0-9_-]+", identity.get("question_id", ""))
            or type(identity.get("run_index")) is not int or identity["run_index"] < 0
            or expected[key]["params"]["messages"] != [{"role": "user", "content": identity.get("question")} ]):
            raise ValueError("invalid Claude batch answer identity")
    if not state.get("id"):
        raise ValueError(f"ambiguous Claude batch submission: {state_path}; reconcile its id in the provider console before retrying")
    results_path = state_path.with_name("results.json")
    if not results_path.exists():
        client = _client(api_key)
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        while True:
            batch = client.messages.batches.retrieve(state["id"])
            if batch.processing_status == "ended":
                break
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Claude batch {state['id']} remains pending; collect it before any new paid work")
            print(f"  Claude batch {state['id']}: {batch.processing_status}", file=sys.stderr, flush=True)
            time.sleep(POLL_SECONDS)
        # Persist the complete download before interpreting it; a parser error
        # must not lose usage or turn a retry into another paid request.
        entries = [entry.model_dump(mode="json") for entry in client.messages.batches.results(state["id"])]
        write_json(results_path, {"fetched_at": utc_now(), "entries": entries})
    saved_results = json.loads(results_path.read_text(encoding="utf-8"))
    entries = saved_results["entries"]
    received = [entry["custom_id"] for entry in entries]
    if len(received) != len(set(received)) or set(received) != set(expected):
        raise ValueError("Claude batch results have missing, duplicate, or unexpected identities; spending remains blocked")
    answers = []
    for entry in entries:
        identity = state["answers"][entry["custom_id"]]
        answer = EngineAnswer(**identity)
        answer.fetched_at = saved_results["fetched_at"]
        answer.measurement_git_sha = state["measurement_git_sha"]
        result = entry["result"]
        if result["type"] == "succeeded":
            answer.text, answer.sources, answer.usage = read_response(Message.model_validate(result["message"]))
            answer.usage["batch_billed"] = 1
            if answer.usage.get("incomplete_response"):
                answer.error = "engine failed: incomplete batch response"
        elif result["type"] in {"errored", "canceled", "expired"}:
            answer.error = f"engine failed: Claude batch {result['type']}"
        else:
            raise ValueError("unknown Claude batch result type")
        destination = state_path.parent.parent / f"claude-{answer.question_id}-{answer.run_index}.json"
        if destination.exists():
            if json.loads(destination.read_text(encoding="utf-8")) != answer.to_dict():
                raise ValueError(f"Claude checkpoint differs from batch result: {destination}")
        else:
            write_json(destination, answer.to_dict())
        answers.append(answer)
    write_json(state_path, {**state, "collected": True}, replace=True)
    return answers


def ask_batch(engine, tasks: list[tuple], checkpoint: Path, measurement_commit: str) -> list[EngineAnswer]:
    state_path = checkpoint / "claude-batch" / "state.json"
    requests = [{"custom_id": f"q{i}", "params": request_params(text)}
                for i, (_, qid, text, index) in enumerate(tasks)]
    identities = {f"q{i}": EngineAnswer("claude", qid, text, index, source_kind=engine.source_kind).to_dict()
                  for i, (_, qid, text, index) in enumerate(tasks)}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if state["requests"] != requests or state["answers"] != identities:
            raise ValueError("Claude batch request identity differs; preserve the checkpoint")
    else:
        state = {"requests": requests, "answers": identities, "submitted_at": utc_now(),
                 "measurement_git_sha": measurement_commit, "collected": False}
        # Write intent BEFORE the POST. A crash between POST and id persistence
        # requires operator reconciliation, never a speculative second POST.
        write_json(state_path, state)
        batch = _client(engine.api_key).messages.batches.create(requests=requests)
        write_json(state_path, {**state, "id": batch.id}, replace=True)
    return collect(state_path, engine.api_key)


if __name__ == "__main__":
    import argparse
    from ..run import ROOT, load_local_env
    from ..storage import run_lock
    from .anthropic_engine import AnthropicEngine

    parser = argparse.ArgumentParser(description="Collect an existing Claude batch without submitting paid work")
    parser.add_argument("state", type=Path)
    args = parser.parse_args()
    state_path = args.state.resolve()
    if not state_path.is_relative_to((ROOT / ".unprompted").resolve()):
        parser.error("state must be inside this checkout's .unprompted directory")
    load_local_env()
    with run_lock(ROOT / ".unprompted"):
        print(f"Collected {len(collect(state_path, AnthropicEngine().api_key))} answers")
