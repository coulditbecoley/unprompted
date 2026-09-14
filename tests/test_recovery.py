"""Offline acceptance for durable recovery and immutable publication."""
import json
from types import SimpleNamespace

import pytest

from unprompted import run
from unprompted.models import EngineAnswer, RunRecord
from unprompted.storage import run_lock, write_json


def test_atomic_publication_and_lock(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "write_report", lambda data, root: root / "report.md")
    record = RunRecord("alpha", "2026-09-14", 1, 1, ["fake"])
    destination = run.persist(record, [])
    assert json.loads(destination.read_text())["publication_checks"] == {"passed": True, "reasons": []}
    original = destination.read_bytes()
    with pytest.raises(FileExistsError):
        run.persist(record, [], overwrite=True)
    assert destination.read_bytes() == original
    for category, day in (("../escape", "2026-09-14"), ("alpha", "../../escape")):
        with pytest.raises(ValueError):
            run.persist(RunRecord(category, day, 1, 1, []), [])
    with pytest.raises(TypeError):
        write_json(destination, {"bad": object()}, replace=True)
    assert destination.read_bytes() == original
    assert not list(destination.parent.glob(".pending-*"))
    with run_lock(tmp_path / "state"):
        with pytest.raises(OSError):
            with run_lock(tmp_path / "state"):
                pytest.fail("concurrent paid work was allowed")
    with run_lock(tmp_path / "state"):
        pass


def test_restart_reuses_paid_answers_and_rejects_changed_method(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases/alpha.yml").write_text("aliases: {}")
    spec = {"category": "alpha", "method_version": 1, "runs_per_question": 3,
            "questions": [{"id": "q1", "text": "Which brand?"}]}
    monkeypatch.setattr(run, "load_questions", lambda category: spec)
    calls = []

    class FakeEngine:
        name = "fake"
        grounds = False
        is_configured = True

        def ask_one(self, qid, text, index):
            calls.append(index)
            return EngineAnswer(self.name, qid, text, index, text="Alpha")

    monkeypatch.setattr(run, "all_engines", lambda: {"fake": FakeEngine()})
    monkeypatch.setattr(run, "resolve_extractor", lambda: SimpleNamespace(id="fake", label="fake"))
    monkeypatch.setattr(run, "check_budget", lambda *args: SimpleNamespace(ok=True, message="offline"))

    def fail_after_answers(*args, **kwargs):
        raise RuntimeError("simulated extraction outage")

    monkeypatch.setattr(run, "extract_run", fail_after_answers)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="extraction outage"):
            run.run_category("alpha", "2026-09-14")
    assert sorted(calls) == [0, 1, 2]
    saved = tmp_path / ".unprompted/2026-09-14/alpha"
    assert len(list(saved.glob("fake-*.json"))) == 3
    answer_path = saved / "fake-q1-0.json"
    answer = json.loads(answer_path.read_text())
    assert answer["text"] == "Alpha"
    answer["run_index"] = 99
    write_json(answer_path, answer, replace=True)
    with pytest.raises(ValueError, match="answer identity differs"):
        run.run_category("alpha", "2026-09-14")
    assert len(calls) == 3
    spec["questions"][0]["text"] = "Changed question"
    with pytest.raises(ValueError, match="methodology differs"):
        run.run_category("alpha", "2026-09-14")
    assert len(calls) == 3


def test_reread_cost_does_not_price_a_new_measurement():
    from unprompted.budget import estimate_category
    reread = {"category": "alpha", "run_date": "2026-09-14", "source_run": "2026-09-01/alpha",
              "extractions": [{"engine": "claude", "usage": {"extract_input_tokens": 1000}}]}
    assert not estimate_category("alpha", 10, [reread]).confident


def test_category_refusal_preserves_other_categories(monkeypatch):
    monkeypatch.setattr(run.sys, "argv", ["run"])
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha", "beta", "gamma"])
    monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
    visited = []

    def category(name, day, **kwargs):
        visited.append(name)
        if name == "beta":
            raise SystemExit("budget refused")
        return RunRecord(name, day, 1, 1, []), []

    monkeypatch.setattr(run, "run_category", category)
    assert run.main() == 2
    assert visited == ["alpha", "beta", "gamma"]


def test_batch_resume_binds_input_and_keeps_invalid_output_usage(tmp_path, monkeypatch):
    from unprompted import extract
    calls = []
    batch = SimpleNamespace(id="offline-batch", processing_status="ended")
    message = SimpleNamespace(content=[SimpleNamespace(text="not JSON")],
                              usage=SimpleNamespace(input_tokens=101, output_tokens=7), stop_reason="end_turn")
    batches = SimpleNamespace(
        create=lambda **kw: calls.append("create") or batch,
        retrieve=lambda key: calls.append("retrieve") or batch,
        results=lambda key: [SimpleNamespace(custom_id="x0", result=SimpleNamespace(type="succeeded", message=message))],
    )
    monkeypatch.setattr(extract, "_client", lambda key: SimpleNamespace(messages=SimpleNamespace(batches=batches)))
    monkeypatch.setattr(extract, "_json_format", lambda: {"type": "json_schema", "schema": {}})
    answer = EngineAnswer("fake", "q1", "Question", 0, text="Alpha")
    checkpoint = tmp_path / "batch.json"
    for _ in range(2):
        result = extract.extract_all_batch([answer], checkpoint=checkpoint)[0]
        assert result.error.startswith("extract failed")
        assert result.usage["extract_input_tokens"] == 101
    assert calls == ["create", "retrieve"]
    answer.text = "Beta"
    assert "identity differs" in extract.extract_all_batch([answer], checkpoint=checkpoint)[0].error
    assert calls == ["create", "retrieve"]


def test_held_readings_are_immutable_and_rereads_add_only_extraction(tmp_path, monkeypatch):
    from unprompted.cost import cost_of_run
    from unprompted.budget import spent_in_month
    from unprompted.models import Extraction
    from datetime import date
    monkeypatch.setattr(run, "ROOT", tmp_path)
    old = RunRecord("alpha", "2026-09-01", 1, 1, ["chatgpt"], extractions=[
        Extraction("chatgpt", "q1", 0, usage={"input_tokens": 1000000, "extract_input_tokens": 1000000})])
    path = run.persist(old, ["held"])
    assert json.loads(path.read_text())["publication_checks"] == {"passed": False, "reasons": ["held"]}
    original = path.read_bytes()
    with pytest.raises(FileExistsError):
        run.persist(old, ["held"], overwrite=True)
    reread = old.to_dict() | {"run_date": "2026-09-14", "source_run": "2026-09-01/alpha"}
    items, reread_cost = cost_of_run(reread)
    assert next(i for i in items if i.label == "chatgpt").calls == 0
    assert reread_cost > 0
    assert spent_in_month(date(2026, 9, 14), [old.to_dict(), reread]) == cost_of_run(old.to_dict())[1] + reread_cost
    assert path.read_bytes() == original


def test_reextract_refuses_budget_before_calls(tmp_path, monkeypatch):
    from unprompted import reextract
    monkeypatch.setattr(reextract, "ROOT", tmp_path)
    monkeypatch.setattr(reextract, "load_local_env", lambda: None)
    monkeypatch.setattr(reextract, "resolve_extractor", lambda: SimpleNamespace(id="offline", label="offline"))
    monkeypatch.setattr(reextract, "check_budget", lambda *a: SimpleNamespace(ok=False, message="offline ceiling"))
    monkeypatch.setattr(reextract, "extract_run", lambda *a, **kw: pytest.fail("paid call after refusal"))
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha")
    write_json(tmp_path / "data/held/2026-09-01/alpha.json", RunRecord("alpha", "2026-09-01", 1, 1, []).to_dict())
    monkeypatch.setattr(run.sys, "argv", ["reextract", "2026-09-01", "--category", "alpha", "--out-date", "2026-09-14"])
    with pytest.raises(SystemExit, match="offline ceiling"):
        reextract.main()


def test_budget_counts_unpublished_checkpoints_once(tmp_path, monkeypatch):
    from unprompted import budget
    from unprompted.cost import cost_of_run
    monkeypatch.setattr(budget, "RUNS_DIR", tmp_path / "data/runs")
    monkeypatch.setattr(budget, "HELD_DIR", tmp_path / "data/held")
    checkpoint = tmp_path / ".unprompted/2026-09-14/alpha"
    write_json(checkpoint / "methodology.json", {})
    answer = EngineAnswer("chatgpt", "q1", "Question", 0, text="Alpha", usage={"input_tokens": 1000000})
    write_json(checkpoint / "chatgpt-q1-0.json", answer.to_dict())
    before = budget._archived_runs()
    assert len(before) == 1 and cost_of_run(before[0])[1] > 0
    write_json(tmp_path / "data/held/2026-09-14/alpha.json", before[0])
    assert budget._archived_runs() == before


def test_permanent_provider_fault_stops_later_calls(monkeypatch):
    from unprompted.engines.base import Engine

    class Exhausted(Engine):
        name = "offline"
        calls = 0

        def _one_call(self, question):
            self.calls += 1
            raise RuntimeError("429 insufficient_quota")

    engine = Exhausted()
    engine.api_key = "offline"
    assert engine.ask_one("q1", "Question", 0).error
    assert "not attempted" in engine.ask_one("q1", "Question", 1).error
    assert engine.calls == 1


def test_truncated_provider_answer_preserves_text_and_usage(monkeypatch):
    import anthropic
    from unprompted.engines.anthropic_engine import AnthropicEngine
    from unprompted.extract import _base_for
    response = SimpleNamespace(stop_reason="max_tokens", content=[SimpleNamespace(type="text", text="Partial Alpha")],
                               usage=SimpleNamespace(input_tokens=123, output_tokens=45))
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: SimpleNamespace(messages=SimpleNamespace(create=lambda **kw: response)))
    engine = AnthropicEngine()
    engine.api_key = "offline"
    answer = engine.ask_one("q1", "Question", 0)
    assert answer.error == "engine failed: incomplete response"
    assert answer.text == "Partial Alpha" and answer.usage["input_tokens"] == 123
    extraction, needed = _base_for(answer)
    assert not needed and extraction.error and extraction.answer == answer.text
