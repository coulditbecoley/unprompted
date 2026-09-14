"""Offline batch acceptance: paid identity, recovery, accounting, and orchestration."""
import json
from types import SimpleNamespace as NS

import pytest

from unprompted import budget, run
from unprompted.cost import cost_of_run
from unprompted.engines import anthropic_batch as batch
from unprompted.engines.anthropic_engine import AnthropicEngine, request_params
from unprompted.storage import write_json


def install_provider(monkeypatch, outcomes=("end_turn", "refusal", "pause_turn", "expired")):
    submitted = []
    def create(**kwargs):
        submitted.append(kwargs["requests"])
        return NS(id="batch-test")
    def results(identifier):
        for i, stop in reversed(list(enumerate(outcomes))):
            result = {"type": "expired"} if stop == "expired" else {
                "type": "succeeded", "message": {
                    "id": f"m{i}", "type": "message", "role": "assistant", "model": "claude-opus-5",
                    "stop_reason": stop, "stop_sequence": None,
                    "content": [{"type": "text", "text": "Alpha is an option."},
                                {"type": "web_search_tool_result", "tool_use_id": "search",
                                 "content": [{"type": "web_search_result", "url": "https://example.com",
                                              "title": "Alpha", "encrypted_content": "test"}]}],
                    "usage": {"input_tokens": 1000, "output_tokens": 100,
                              "cache_read_input_tokens": 200, "cache_creation_input_tokens": 300,
                              "cache_creation": {"ephemeral_1h_input_tokens": 100, "ephemeral_5m_input_tokens": 200},
                              "server_tool_use": {"web_search_requests": 2, "web_fetch_requests": 0}},
                }}
            entry = {"custom_id": f"q{i}", "result": result}
            yield NS(model_dump=lambda mode, value=entry: value)
    api = NS(create=create, retrieve=lambda identifier: NS(processing_status="ended"), results=results)
    monkeypatch.setattr(batch, "_client", lambda key: NS(messages=NS(batches=api)))
    engine = AnthropicEngine()
    engine.api_key = "offline"
    return engine, api, submitted


def test_batch_reuses_identity_preserves_evidence_and_never_retries_paid_results(tmp_path, monkeypatch):
    engine, api, submitted = install_provider(monkeypatch)
    tasks = [(engine, "q1", "Which brand?", i) for i in range(4)]
    answers = batch.ask_batch(engine, tasks, tmp_path, "original-sha")
    assert submitted[0][0]["params"] == request_params("Which brand?")
    by_index = {a.run_index: a for a in answers}
    assert by_index[0].sources == ["https://example.com"]
    assert by_index[0].text == "Alpha is an option."
    assert by_index[0].usage["batch_billed"] == 1
    assert by_index[0].usage["cache_creation_1h_input_tokens"] == 100
    assert by_index[1].text == "" and by_index[1].error is None
    assert by_index[2].error and by_index[2].usage["output_tokens"] == 100
    assert by_index[3].error.endswith("expired") and not by_index[3].usage
    assert all(a.measurement_git_sha == "original-sha" for a in answers)
    api.retrieve = lambda identifier: pytest.fail("completed checkpoint contacted provider")
    assert batch.ask_batch(engine, tasks, tmp_path, "new-sha") == answers
    assert len(submitted) == 1
    with pytest.raises(ValueError, match="identity differs"):
        batch.ask_batch(engine, [(engine, "q1", "Changed", 0)], tmp_path, "new-sha")


def test_timeout_and_ambiguous_submission_block_spending(tmp_path, monkeypatch):
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    checkpoint = tmp_path / ".unprompted/2026-09-14/alpha"
    write_json(checkpoint / "methodology.json", {})
    monkeypatch.setattr(budget, "RUNS_DIR", tmp_path / "data/runs")
    monkeypatch.setattr(budget, "HELD_DIR", tmp_path / "data/held")
    api.retrieve = lambda identifier: NS(processing_status="in_progress")
    monkeypatch.setattr(batch, "MAX_WAIT_SECONDS", 0)
    with pytest.raises(TimeoutError):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], checkpoint, "sha")
    with pytest.raises(ValueError, match="unaccounted"):
        budget._archived_runs()
    api.retrieve = lambda identifier: NS(processing_status="ended")
    batch.collect(checkpoint / "claude-batch/state.json", "offline")
    assert len(submitted) == 1 and len(budget._archived_runs()) == 1
    def uncertain(**kwargs):
        raise TimeoutError("POST accepted but connection lost")
    api.create = uncertain
    other = tmp_path / "other"
    with pytest.raises(TimeoutError):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], other, "sha")
    api.create = lambda **kwargs: pytest.fail("ambiguous job was resubmitted")
    with pytest.raises(ValueError, match="ambiguous"):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], other, "sha")


@pytest.mark.parametrize("ids", [[], ["q0", "q0"], ["unexpected"]])
def test_batch_rejects_incomplete_or_duplicate_result_sets(tmp_path, monkeypatch, ids):
    engine, api, _ = install_provider(monkeypatch, ("end_turn",))
    api.results = lambda identifier: iter([NS(model_dump=lambda mode, key=key: {"custom_id": key}) for key in ids])
    with pytest.raises(ValueError, match="identities"):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], tmp_path, "sha")
    assert not json.loads((tmp_path / "claude-batch/state.json").read_text())["collected"]


def test_budget_estimates_discount_without_repricing_history():
    historic = {"category": "alpha", "run_date": "2026-09-14", "extractions": [
        {"engine": "claude", "usage": {"input_tokens": 1_000_000, "output_tokens": 100_000, "web_searches": 4}}]}
    assert cost_of_run(historic)[1] == 7.54
    assert budget.estimate_category("alpha", 1, [historic]).dollars == 3.79
    assert cost_of_run(historic)[1] == 7.54


def test_openai_counts_actual_search_calls_and_captures_cache_usage(monkeypatch):
    import openai
    from unprompted.engines.openai_engine import OpenAIEngine
    response = NS(output_text="Alpha", status="completed", output=[NS(type="web_search_call"),
                  NS(type="message"), NS(type="web_search_call")], usage=NS(
        input_tokens=1000, output_tokens=200, input_tokens_details=NS(cached_tokens=500),
        output_tokens_details=NS(reasoning_tokens=150)))
    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: NS(responses=NS(create=lambda **kwargs: response)))
    engine = OpenAIEngine()
    engine.api_key = "offline"
    answer = engine.ask_one("q1", "Which?", 0)
    assert answer.usage["web_searches"] == 2
    assert answer.usage["cached_input_tokens"] == 500
    assert answer.usage["reasoning_tokens"] == 150
    response.output = []
    assert engine.ask_one("q1", "Which?", 1).usage["web_searches"] == 0


def test_orchestrator_uses_batch_and_restarts_without_sync_fallback(tmp_path, monkeypatch):
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "git_sha", lambda: "offline-sha")
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases/alpha.yml").write_text("canonical: {}")
    monkeypatch.setattr(run, "load_questions", lambda category: {
        "category": "alpha", "method_version": 1, "runs_per_question": 1,
        "questions": [{"id": "q1", "text": "Which brand?"}]})
    monkeypatch.setattr(run, "all_engines", lambda: {"claude": engine})
    monkeypatch.setattr(run, "resolve_extractor", lambda: NS(id="fake", label="fake"))
    monkeypatch.setattr(run, "check_budget", lambda *args: NS(ok=True, message="offline"))
    engine.ask_one = lambda *args: pytest.fail("weekly path used full-price synchronous request")
    def extract(answers, *args, **kwargs):
        assert len(answers) == 1 and answers[0].usage["batch_billed"] == 1
        raise RuntimeError("stop before publication")
    monkeypatch.setattr(run, "extract_run", extract)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="stop before publication"):
            run.run_category("alpha", "2026-09-14")
    assert len(submitted) == 1
