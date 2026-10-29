"""Offline batch acceptance: paid identity, recovery, accounting, and orchestration."""
import json
from pathlib import Path
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
                    "content": [{"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "alpha brand"}},
                                {"type": "text", "text": "Alpha is an option.", "citations": [
                                     {"type": "web_search_result_location", "url": "https://example.com", "title": "Alpha",
                                      "encrypted_index": "x", "cited_text": "Alpha"}]},
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
    assert by_index[0].metadata == {"model": "claude-opus-5", "stop_reason": "end_turn", "cited": ["https://example.com"], "queries": ["alpha brand"]}
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
    monkeypatch.setattr(batch, "MAX_WAIT_SECONDS", 3600)  # downloads share the wait's clock
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
    assert budget.estimate_category("alpha", 1, [historic]).dollars == 3.04
    assert cost_of_run(historic)[1] == 7.54


def test_openai_counts_actual_search_calls_and_captures_cache_usage(monkeypatch):
    import openai
    from unprompted.engines.openai_engine import OpenAIEngine
    response = NS(output_text="Alpha", status="completed", model="gpt-6-sol-2026-09-01", output=[NS(type="web_search_call", action=NS(query="best ai coding tools")),
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
    assert answer.metadata == {"model": "gpt-6-sol-2026-09-01", "status": "completed", "queries": ["best ai coding tools"]}
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
    monkeypatch.setattr(run, "check_budget", lambda *args, **kwargs: NS(ok=True, message="offline"))
    engine.ask_one = lambda *args: pytest.fail("weekly path used full-price synchronous request")
    def extract(answers, *args, **kwargs):
        assert len(answers) == 1 and answers[0].usage["batch_billed"] == 1
        raise RuntimeError("stop before publication")
    monkeypatch.setattr(run, "extract_run", extract)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="stop before publication"):
            run.run_category("alpha", "2026-09-14")
    assert len(submitted) == 1


def test_perplexity_agent_response_reads_text_sources_and_searches():
    from unprompted.engines.perplexity_engine import read_response
    body = {"status": "completed", "output": [
        {"type": "search_results", "results": [{"url": "https://a.example"}, {"url": "https://b.example"}]},
        {"type": "message", "content": [{"type": "output_text", "text": "Use Alpha.", "annotations": []}]}],
        "usage": {"input_tokens": 4521, "output_tokens": 282,
                  "tool_calls_details": {"search_web": {"cost_usd": 0.0025, "invocation": 1}}}}
    text, sources, usage = read_response(body)
    assert text == "Use Alpha."
    assert sources == ["https://a.example", "https://b.example"]
    assert usage == {"input_tokens": 4521, "output_tokens": 282, "web_searches": 1}
    assert read_response({**body, "status": "incomplete"})[2]["incomplete_response"] == 1


def test_runs_are_priced_at_the_rates_of_their_own_date():
    from unprompted.cost import rates_for, RATES
    usage = {"input_tokens": 1_000_000, "output_tokens": 0}
    old = {"run_date": "2026-09-14", "extractions": [{"engine": "chatgpt", "usage": usage}]}
    new = {**old, "run_date": "2026-09-28"}
    assert rates_for("2026-09-27")["chatgpt"]["input_per_m"] == 1.25
    assert rates_for("2026-09-28") is RATES
    assert cost_of_run(old)[1] == 1.25 and cost_of_run(new)[1] == 2.0
    assert cost_of_run(old, current_rates=True)[1] == 2.0



def _stale_week(tmp_path, monkeypatch, engine, api):
    """A paid Claude batch from an earlier week, submitted but never collected."""
    monkeypatch.setattr(budget, "RUNS_DIR", tmp_path / "data/runs")
    monkeypatch.setattr(budget, "HELD_DIR", tmp_path / "data/held")
    monkeypatch.setattr(batch, "POLL_SECONDS", 0)
    stale = tmp_path / ".unprompted/2026-10-19/alpha"
    write_json(stale / "methodology.json", {})
    api.retrieve = lambda identifier: NS(processing_status="in_progress")
    monkeypatch.setattr(batch, "MAX_WAIT_SECONDS", 0)
    with pytest.raises(TimeoutError):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], stale, "sha")
    monkeypatch.setattr(batch, "MAX_WAIT_SECONDS", 3600)
    return stale / "claude-batch/state.json"


def _week_spend():
    return sum(cost_of_run(r)[1] for r in budget._archived_runs())


def test_dropped_poll_connection_is_retried_and_old_weeks_are_collected_before_spending(tmp_path, monkeypatch):
    # 2026-10-19: one reset connection while polling killed the category and
    # left a paid batch uncollected, which then refused every later week.
    from anthropic import APIConnectionError
    import httpx
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    stale = _stale_week(tmp_path, monkeypatch, engine, api)
    with pytest.raises(ValueError, match="unaccounted"):
        budget._archived_runs()
    drops = iter([True])
    def flaky(identifier):
        if next(drops, False):
            raise APIConnectionError(request=httpx.Request("GET", "https://api.anthropic.com"))
        return NS(processing_status="ended")
    api.retrieve = flaky
    assert batch.collect_outstanding(tmp_path / ".unprompted", "offline") == ([stale], [])
    spend = _week_spend()
    assert spend > 0
    api.retrieve = lambda identifier: pytest.fail("collected batch contacted provider")
    assert batch.collect_outstanding(tmp_path / ".unprompted", "offline") == ([], [])
    assert _week_spend() == spend
    assert len(submitted) == 1


def test_outstanding_extraction_batches_are_collected_in_normal_and_reextract_dirs(tmp_path, monkeypatch):
    from anthropic.types.messages import MessageBatchIndividualResponse
    from unprompted import extract
    reply = {"custom_id": "x0", "result": {"type": "errored", "error": {"type": "error", "error": {"type": "api_error", "message": "x"}}}}
    jobs = [tmp_path / ".unprompted/2026-10-19/alpha/batch.json", tmp_path / ".unprompted/reextract/2026-10-19/beta/batch.json"]
    for job in jobs:
        write_json(job, {"id": "ext", "identity": "i", "answers": 1, "result_checkpoint_version": 1})
    legacy = tmp_path / ".unprompted/2026-09-14/gamma/batch.json"
    write_json(legacy, {"id": "consumed-and-expired"})
    batches = NS(create=lambda **kw: pytest.fail("submitted"), retrieve=lambda key: NS(id=key, processing_status="ended"),
                 results=lambda key: iter([NS(model_dump=lambda mode: reply)]))
    monkeypatch.setattr(extract, "_client", lambda key: NS(messages=NS(batches=batches)))
    assert batch.collect_outstanding(tmp_path / ".unprompted", "offline") == (sorted(jobs), [])
    assert all((job.parent / "extraction-batch/results.json").exists() for job in jobs)
    assert batch.collect_outstanding(tmp_path / ".unprompted", "offline") == ([], [])


@pytest.mark.parametrize("failure", ["malformed", "download", "deadline", "idless"])
def test_recovery_failures_are_reported_and_keep_spending_blocked(tmp_path, monkeypatch, failure):
    from anthropic import APIConnectionError
    import httpx
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    stale = _stale_week(tmp_path, monkeypatch, engine, api)
    state = json.loads(stale.read_text())
    if failure == "malformed":
        stale.write_text("{not json")
    elif failure == "idless":
        write_json(stale, {**state, "id": None}, replace=True)
    else:
        monkeypatch.setattr(batch, "RECOVERY_SECONDS", 0)
        if failure == "download":
            api.retrieve = lambda identifier: NS(processing_status="ended")
            def dropped(identifier):
                raise APIConnectionError(request=httpx.Request("GET", "https://api.anthropic.com"))
            api.results = dropped
    collected, failed = batch.collect_outstanding(tmp_path / ".unprompted", "offline")
    assert collected == []
    assert len(failed) == 1 and str(stale) in failed[0]
    if failure == "idless":  # reported for the owner to reconcile, never resubmitted
        assert "reconciliation" in failed[0]
    assert not stale.with_name("results.json").exists()
    with pytest.raises(ValueError):
        budget._archived_runs()
    assert len(submitted) == 1


@pytest.mark.parametrize("lock_fails", [False, True])
def test_weekly_main_recovers_old_batches_before_categories_and_reports_failures(tmp_path, monkeypatch, lock_fails):
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    stale = _stale_week(tmp_path, monkeypatch, engine, api)
    api.retrieve = lambda identifier: NS(processing_status="ended")
    api.create = lambda **kwargs: pytest.fail("weekly start submitted paid work")
    broken = tmp_path / ".unprompted/2026-10-12/beta/claude-batch/state.json"
    broken.parent.mkdir(parents=True)
    broken.write_text("{not json")
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha"])
    seen = []
    def category(name, date, **kwargs):
        seen.append(json.loads(stale.read_text()).get("collected"))
        raise SystemExit("stub category")
    monkeypatch.setattr(run, "run_category", category)
    if lock_fails:
        real = run.run_lock
        def locked(root, name="run.lock", wait=0.0):
            if name == "run.lock":  # the recovery phase's lock; the week lock is real
                raise RuntimeError("another run holds the lock")
            return real(root, name, wait)
        monkeypatch.setattr(run, "run_lock", locked)
    summary = tmp_path / "summary.json"
    monkeypatch.setattr("sys.argv", ["run", "--date", run.date.today().isoformat(), "--summary-file", str(summary)])
    assert run.main() == run.HELD_EXIT_CODE
    detail = json.loads(summary.read_text())["detail"]
    # Unaccounted spend blocks the week: no category runs.
    assert seen == [] and "alpha: not run" in detail
    if lock_fails:
        assert "recovery: outstanding-batch recovery raised RuntimeError" in detail
    else:
        assert json.loads(stale.read_text())["collected"]
        assert f"recovery: could not collect {broken}" in detail
    assert len(submitted) == 1


def test_weekly_main_runs_categories_after_a_clean_recovery(tmp_path, monkeypatch):
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    stale = _stale_week(tmp_path, monkeypatch, engine, api)
    api.retrieve = lambda identifier: NS(processing_status="ended")
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha"])
    seen = []
    def category(name, date, **kwargs):
        seen.append(json.loads(stale.read_text()).get("collected"))
        raise SystemExit("stub category")
    monkeypatch.setattr(run, "run_category", category)
    monkeypatch.setattr("sys.argv", ["run", "--date", run.date.today().isoformat()])  # a paid run must be dated this month
    run.main()
    assert seen == [True] and len(submitted) == 1


def test_a_results_stream_that_drops_midway_is_downloaded_again_whole(tmp_path, monkeypatch):
    import httpx2
    engine, api, submitted = install_provider(monkeypatch, ("end_turn", "end_turn"))
    monkeypatch.setattr(batch, "POLL_SECONDS", 0)
    complete, drops = api.results, iter([True])
    def flaky(identifier):
        entries = complete(identifier)
        yield next(entries)
        if next(drops, False):
            raise httpx2.ReadError("connection reset mid-stream")
        yield from entries
    api.results = flaky
    answers = batch.ask_batch(engine, [(engine, "q1", "Which?", i) for i in range(2)], tmp_path, "sha")
    assert len(answers) == 2 and len(submitted) == 1


def _gemini(monkeypatch, body):
    import io
    from unprompted.engines import gemini_engine
    monkeypatch.setattr(gemini_engine.urllib.request, "urlopen",
                        lambda request, timeout: io.BytesIO(json.dumps(body).encode()))
    monkeypatch.setattr("unprompted.engines.base.time.sleep", lambda s: None)
    engine = gemini_engine.GeminiEngine()
    engine.api_key = "offline"
    return engine.ask_one("q1", "Which?", 0)


def test_gemini_keeps_provider_evidence_and_bills_each_search_query(monkeypatch):
    from unprompted.extract import _base_for
    grounding = {"webSearchQueries": ["a", "b", "c"], "searchEntryPoint": {"renderedContent": "<html>"},
                 "groundingChunks": [{"web": {"uri": "https://vertexaisearch/x", "title": "example.com"}}]}
    body = {"modelVersion": "gemini-3.5-flash-002",
            "candidates": [{"finishReason": "STOP", "groundingMetadata": grounding,
                            "content": {"parts": [{"text": "Alpha."}]}}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5}}
    answer = _gemini(monkeypatch, body)
    assert answer.ok and answer.sources == ["https://example.com"]
    assert answer.usage["web_searches"] == 3 and "requests" not in answer.usage
    assert answer.metadata == {"modelVersion": "gemini-3.5-flash-002", "finishReason": "STOP",
                               "groundingMetadata": grounding}
    assert _base_for(answer)[0].to_dict()["metadata"] == answer.metadata

    # Answered from memory: no grounding key at all, which stays distinguishable from {}.
    del body["candidates"][0]["groundingMetadata"]
    ungrounded = _gemini(monkeypatch, body)
    assert ungrounded.ok and ungrounded.usage["web_searches"] == 0
    assert "groundingMetadata" not in ungrounded.metadata

    for failed in ({"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": {"promptTokenCount": 10}},
                   {**body, "candidates": [{**body["candidates"][0], "finishReason": "MAX_TOKENS"}]}):
        answer = _gemini(monkeypatch, failed)
        assert answer.error == "engine failed: incomplete response"
        assert answer.usage["input_tokens"] == 10


def test_records_without_metadata_round_trip_unchanged_and_searches_price_by_presence():
    from unprompted.cost import _price, _searches
    from unprompted.models import EngineAnswer, Extraction
    legacy = EngineAnswer("claude", "q1", "Which?", 0).to_dict()
    assert "metadata" not in legacy and EngineAnswer(**legacy).to_dict() == legacy
    assert "metadata" not in Extraction("claude", "q1", 0).to_dict()
    assert _searches({"requests": 1}) == 1
    assert _searches({"web_searches": 0, "requests": 1}) == 0
    assert _price("gemini", {"web_searches": 2}) == 2 * _price("gemini", {"web_searches": 1}) > 0


def test_batch_waits_end_with_the_run_not_after_one_hour(monkeypatch):
    # 2026-10-19: a one-hour cap stranded a paid batch that would have ended.
    from unprompted.engines import base
    monkeypatch.setattr(base, "_PROCESS_STARTED", base.time.monotonic())
    assert base.wait_deadline(batch.MAX_WAIT_SECONDS) - base.time.monotonic() > 5 * 3600
    monkeypatch.setattr(base, "_PROCESS_STARTED", base.time.monotonic() - base.RUN_SECONDS + 60)
    assert base.wait_deadline(batch.MAX_WAIT_SECONDS) - base.time.monotonic() <= 60


def test_gemini_is_told_to_search_and_reports_the_model_google_serves(monkeypatch):
    # 2026-10-29: gemini-3.5-flash requests were answered by gemini-3.6-flash,
    # which searched for 1 of 8 questions unprompted and 8 of 8 when told to.
    import io
    from unprompted.cli_provider import ProviderError
    from unprompted.engines import gemini_engine
    sent = []
    body = {"modelVersion": "gemini-3.6-flash", "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "OK"}]}}]}

    def urlopen(request, timeout):
        sent.append(json.loads(request.data))
        return io.BytesIO(json.dumps(body).encode())
    from unprompted import budget
    monkeypatch.setattr(gemini_engine.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    monkeypatch.setattr(budget, "spent_in_month", lambda when: budget.MONTHLY_CEILING)
    engine = gemini_engine.GeminiEngine()
    engine.api_key = "offline"
    with pytest.raises(ProviderError, match="budget is spent"):
        engine.identify()
    assert not sent
    monkeypatch.setattr(budget, "MONTHLY_CEILING", 0)  # a disabled ceiling never refuses
    assert engine.identify()["model"] == "gemini-3.6-flash"
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    monkeypatch.setattr(budget, "MONTHLY_CEILING", 350.0)
    monkeypatch.setattr(budget, "spent_in_month", lambda when: 0)
    sent.clear()
    assert engine.identify() == {"model": "gemini-3.6-flash", "version": "requested gemini-3.5-flash"}
    probe = sent[0]  # bounded and search-free
    assert probe["tools"] == [{"google_search": {}}] and probe["generationConfig"]["maxOutputTokens"] == 16
    engine.identify()
    assert len(sent) == 1  # once per process
    engine.ask_one("q1", "Which?", 0)
    assert sent[1]["system_instruction"]["parts"][0]["text"].endswith("Search the web for current information before answering.")
    # Re-routed mid-run: the text and usage stay, the answer does not count.
    body["modelVersion"] = "gemini-3.8-flash"
    moved = engine.ask_one("q1", "Which?", 0)
    assert moved.error and "different model" in moved.error and moved.text == "OK"
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    del body["modelVersion"]
    with pytest.raises(ProviderError, match="did not say"):
        engine.identify()
    probes = len(sent)
    with pytest.raises(ProviderError, match="did not say"):
        engine.identify()  # a failed probe is not repeated for each category
    assert len(sent) == probes


def test_retries_stop_when_the_run_clock_is_spent(monkeypatch):
    from unprompted.engines import base
    calls = []

    class Flaky(base.Engine):
        name, key_names = "flaky", ()
        def is_retryable(self, exc):
            return True
        def _one_call(self, question):
            calls.append(1)
            monkeypatch.setattr(base, "run_time_left", lambda: -1)
            raise ConnectionError("reset")
    monkeypatch.setattr(base.time, "sleep", lambda s: None)
    engine = Flaky()
    engine.api_key = "x"
    answer = engine.ask_one("q1", "Which?", 0)
    assert len(calls) == 1 and "reset" in answer.error


def test_nothing_new_is_paid_for_once_the_run_clock_is_spent(tmp_path, monkeypatch):
    from unprompted.engines import base
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    monkeypatch.setattr(base, "_PROCESS_STARTED", base.time.monotonic() - base.RUN_SECONDS - 1)
    with pytest.raises(TimeoutError, match="budget is spent"):
        batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], tmp_path, "sha")
    assert not submitted and not (tmp_path / "claude-batch/state.json").exists()


def test_a_category_is_not_started_without_time_to_finish_it(tmp_path, monkeypatch):
    from unprompted import run
    started = []
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha"])
    monkeypatch.setattr(run, "run_category", lambda *a, **k: started.append(a))
    monkeypatch.setattr(run, "run_time_left", lambda: run.CATEGORY_RESERVE_SECONDS - 1)
    monkeypatch.setattr("unprompted.engines.anthropic_batch.collect_outstanding", lambda *a: ([], []))
    monkeypatch.setattr(run.sys, "argv", ["run", "--summary-file", str(tmp_path / "s.json")])
    assert run.main() == run.HELD_EXIT_CODE and not started
    summary = json.loads((tmp_path / "s.json").read_text())
    assert "not started" in summary["detail"] and summary["categories"]["alpha"]["outcome"] == "not_started"


def test_the_status_file_says_each_categorys_outcome_without_parsing_prose(tmp_path, monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location("notify", Path(__file__).resolve().parents[1] / "scripts/notify.py")
    notify = importlib.util.module_from_spec(spec); spec.loader.exec_module(notify)
    monkeypatch.setattr(notify, "REPO", tmp_path)
    monkeypatch.setattr(notify, "STATUS_FILE", tmp_path / "last-run.json")
    notify.write_status("held", "alpha: held", 2, {"run_date": "2026-11-02", "detail": "x",
                        "categories": {"alpha": {"outcome": "held", "reasons": ["Gemini cited on 9 of 75"]}}})
    status = json.loads((tmp_path / "last-run.json").read_text())
    assert status["run_date"] == "2026-11-02" and status["categories"]["alpha"]["outcome"] == "held"
    assert status["detail"] == "alpha: held"


def test_collect_only_downloads_and_spends_nothing(tmp_path, monkeypatch):
    from unprompted import run
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "run_category", lambda *a, **k: pytest.fail("measured"))
    monkeypatch.setattr("unprompted.engines.anthropic_batch.collect_outstanding",
                        lambda *a: ([tmp_path / "job"], ["could not collect other"]))
    monkeypatch.setattr(run.sys, "argv", ["run", "--collect-only"])
    assert run.main() == 1


def test_extracted_brand_names_survive_normalisation_for_free_alias_rereads():
    from unprompted.models import BrandMention, Extraction
    from unprompted.normalize import AliasMap, normalize
    ex = Extraction("one", "q1", 0, brands=[BrandMention("Acme Inc", 1), BrandMention("Mystery", 2),
                                             BrandMention("Dropped", 3)], answer="Acme Inc, Mystery, Dropped")
    (cleaned,), quarantined = normalize([ex], AliasMap({"Acme": ["Acme Inc"]}, ["Dropped"]))
    assert [b.name for b in cleaned.brands] == ["Acme"] and quarantined == ["Mystery"]
    assert [b["name"] for b in cleaned.to_dict()["extracted"]] == ["Acme Inc", "Mystery", "Dropped"]
    normalize([cleaned], AliasMap({"Acme": ["Acme Inc"]}, []))
    assert cleaned.extracted[0]["name"] == "Acme Inc"  # a second pass keeps the original reading
    assert "extracted" not in Extraction("one", "q1", 0).to_dict()  # older records round-trip unchanged


def test_timed_ends_the_whole_process_tree(tmp_path):
    # git leaves network work to helper processes; a timeout must end them too.
    import subprocess, sys, time
    marker = tmp_path / "survivor"
    child = f"import time; time.sleep(3); open({str(marker)!r}, 'w').write('x')"
    parent = f"import subprocess, sys, time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(30)"
    started = time.monotonic()
    code = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "scripts/timed.py"), "1",
                           sys.executable, "-c", parent]).returncode
    assert code == 124 and time.monotonic() - started < 15
    time.sleep(4)
    assert not marker.exists()


def test_checkpoints_with_less_metadata_still_collect_but_conflicts_do_not(tmp_path, monkeypatch):
    engine, api, submitted = install_provider(monkeypatch, ("end_turn",))
    batch.ask_batch(engine, [(engine, "q1", "Which?", 0)], tmp_path, "sha")
    saved = tmp_path / "claude-q1-0.json"
    state = tmp_path / "claude-batch/state.json"
    record = json.loads(saved.read_text())
    for older in ({"model": "claude-opus-5", "stop_reason": "end_turn"}, None):  # before `cited`, before metadata
        write_json(saved, {**record, "metadata": older} if older else {k: v for k, v in record.items() if k != "metadata"}, replace=True)
        write_json(state, {**json.loads(state.read_text()), "collected": False}, replace=True)
        assert len(batch.collect(state, "offline")) == 1
    write_json(saved, {**record, "metadata": {"model": "another-model"}}, replace=True)
    write_json(state, {**json.loads(state.read_text()), "collected": False}, replace=True)
    with pytest.raises(ValueError, match="differs"):
        batch.collect(state, "offline")


def test_a_transient_gemini_probe_failure_is_retried_not_fatal(monkeypatch):
    from unprompted import budget
    from unprompted.engines import gemini_engine
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    monkeypatch.setattr(budget, "spent_in_month", lambda when: 0)
    monkeypatch.setattr(gemini_engine.time, "sleep", lambda s: None)
    replies = [ConnectionError("503 UNAVAILABLE"), {"modelVersion": "gemini-3.6-flash"}]
    def probe(self):
        reply = replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply
    monkeypatch.setattr(gemini_engine.GeminiEngine, "_probe", probe)
    assert gemini_engine.GeminiEngine().identify()["model"] == "gemini-3.6-flash"


def test_an_idless_extraction_intent_blocks_recovery_only_when_it_was_submitted(tmp_path):
    for started, version, failures in ((False, None, 0), (True, 1, 1), (False, 1, 1)):  # mirrors budget.py
        job = tmp_path / f"{started}{version}/.unprompted/2026-09-14/alpha/batch.json"
        write_json(job, {"result_checkpoint_version": version, **({"submission_started": True} if started else {})})
        assert len(batch.collect_outstanding(job.parents[2], "offline")[1]) == failures


def test_a_gemini_probe_retry_is_not_started_after_the_run_clock(monkeypatch):
    from unprompted import budget
    from unprompted.engines import base, gemini_engine
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    monkeypatch.setattr(budget, "spent_in_month", lambda when: 0)
    probes = []
    def probe(self):
        probes.append(1)
        monkeypatch.setattr(base, "_PROCESS_STARTED", base.time.monotonic() - base.RUN_SECONDS - 1)
        raise ConnectionError("503 UNAVAILABLE")
    monkeypatch.setattr(gemini_engine.GeminiEngine, "_probe", probe)
    monkeypatch.setattr(gemini_engine.time, "sleep", lambda s: None)
    with pytest.raises(TimeoutError, match="budget is spent"):
        gemini_engine.GeminiEngine().identify()
    assert len(probes) == 1


def test_openai_queries_are_read_from_both_sdk_shapes(monkeypatch):
    import openai
    from openai.types.responses.response_function_web_search import ActionSearch
    from unprompted.engines.openai_engine import OpenAIEngine
    calls = [NS(type="web_search_call", action=ActionSearch(type="search", queries=["one", "two"], query="one")),
             NS(type="web_search_call", action=ActionSearch(type="search", query="three")), NS(type="message")]
    response = NS(output_text="Alpha", status="completed", model="m", output=calls, usage=None)
    monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: NS(responses=NS(create=lambda **kwargs: response)))
    engine = OpenAIEngine()
    engine.api_key = "offline"
    assert engine.ask_one("q1", "Which?", 0).metadata["queries"] == ["one", "two", "three"]


def test_the_week_lock_spans_every_category(tmp_path, monkeypatch):
    from unprompted import run
    from unprompted.storage import run_lock
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha", "beta"])
    monkeypatch.setattr("unprompted.engines.anthropic_batch.collect_outstanding", lambda *a: ([], []))
    held_during = []
    def category(*a, **k):
        try:
            with run_lock(tmp_path / ".unprompted", "week.lock"):
                held_during.append(False)
        except OSError:
            held_during.append(True)
        raise RuntimeError("stop")
    monkeypatch.setattr(run, "run_category", category)
    monkeypatch.setattr(run.sys, "argv", ["run"])
    run.main()
    assert held_during == [True, True]


def test_a_gemini_probe_that_searches_is_reported(monkeypatch, capsys):
    from unprompted import budget
    from unprompted.engines import gemini_engine
    monkeypatch.setattr(gemini_engine, "_SERVED", {})
    monkeypatch.setattr(budget, "spent_in_month", lambda when: 0)
    monkeypatch.setattr(gemini_engine.GeminiEngine, "_probe", lambda self: {"modelVersion": "gemini-3.6-flash", "web_searches": 2})
    assert gemini_engine.GeminiEngine().identify()["model"] == "gemini-3.6-flash"
    assert "probe searched 2 time(s)" in capsys.readouterr().err


def test_the_run_clock_is_never_a_faked_clock():
    # Under tests/future_date.py only the calendar may move: freezegun's fake
    # monotonic differs between threads, so the run clock must stay real.
    import subprocess
    import sys
    import time
    from concurrent.futures import ThreadPoolExecutor
    fake = lambda f: "freezegun" in (getattr(f, "__module__", "") or "")
    assert not fake(time.monotonic) and not fake(time.perf_counter)
    # Aliases imported by name before any freezing, as subprocess does.
    assert not fake(getattr(subprocess, "_time", time.monotonic))
    clocks = {"fake_monotonic", "fake_monotonic_ns", "fake_perf_counter", "fake_perf_counter_ns"}
    assert not [f"{name}.{attr}" for name, m in list(sys.modules.items()) if m and not name.startswith("freezegun")
                for attr, v in list(vars(m).items()) if callable(v) and getattr(v, "__name__", "") in clocks]
    with ThreadPoolExecutor(1) as pool:  # and a worker reads the same clock
        assert abs(pool.submit(time.monotonic).result() - time.monotonic()) < 5
