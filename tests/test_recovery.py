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


def test_restart_reuses_paid_answers_and_rejects_changed_method(tmp_path, monkeypatch, capsys):
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
    assert "reused 3/3 saved calls; 0 calls remaining" in capsys.readouterr().err
    saved = tmp_path / ".unprompted/2026-09-14/alpha"
    assert len(list(saved.glob("fake-*.json"))) == 3
    answer_path = saved / "fake-q1-0.json"
    answer = json.loads(answer_path.read_text())
    assert answer["text"] == "Alpha"
    answer_path.unlink()  # emulate one call that never reached its durable checkpoint
    with pytest.raises(RuntimeError, match="extraction outage"):
        run.run_category("alpha", "2026-09-14")
    progress = capsys.readouterr().err
    assert "reused 2/3 saved calls; 1 calls remaining" in progress
    assert "3/3 calls (0 failed)" in progress
    assert calls.count(0) == 2 and len(calls) == 4
    answer["run_index"] = 99
    write_json(answer_path, answer, replace=True)
    with pytest.raises(ValueError, match="answer identity differs"):
        run.run_category("alpha", "2026-09-14")
    assert len(calls) == 4
    spec["questions"][0]["text"] = "Changed question"
    with pytest.raises(ValueError, match="methodology differs"):
        run.run_category("alpha", "2026-09-14")
    assert len(calls) == 4


def test_measurement_refuses_noncanonical_dates_before_provider_resolution(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_questions", lambda category: {})
    monkeypatch.setattr(run, "all_engines", lambda: pytest.fail("provider resolution reached for invalid date"))
    for day in ("20260914", "2026-W38-1", "2026-13-01"):
        with pytest.raises(ValueError):
            run.run_category("alpha", day)
    assert not list(tmp_path.rglob("*.json"))
    assert not (tmp_path / "data").exists()


def test_preflight_combines_budget_without_measurement_or_output_writes(tmp_path, monkeypatch, capsys):
    from unprompted import budget
    monkeypatch.setattr(run, "ROOT", tmp_path)
    monkeypatch.setattr(run, "load_local_env", lambda: None)
    monkeypatch.setattr(run, "all_categories", lambda: ["alpha", "beta"])
    monkeypatch.setattr(run, "load_questions", lambda category: {"questions": [{"id": "q1"}], "runs_per_question": 2})
    monkeypatch.setattr(run, "all_engines", lambda: {"offline": SimpleNamespace(is_configured=True)})
    monkeypatch.setattr(run, "resolve_extractor", lambda: SimpleNamespace(id="offline"))
    monkeypatch.setattr(run, "run_category", lambda *a, **kw: pytest.fail("preflight started a measurement"))
    monkeypatch.setattr(run, "extract_run", lambda *a, **kw: pytest.fail("preflight made an extractor call"))
    monkeypatch.setattr(budget, "_archived_runs", lambda: [])
    monkeypatch.setattr(budget, "spent_in_month", lambda *a: 5)
    monkeypatch.setattr(budget, "estimate_category", lambda *a: budget.Estimate(6, "offline basis", True))
    monkeypatch.setattr(budget, "MONTHLY_CEILING", 15)
    (tmp_path / "aliases").mkdir()
    for category in ("alpha", "beta"):
        (tmp_path / f"aliases/{category}.yml").write_text("canonical: {}")
    output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(run.sys, "argv", ["run", "--preflight"])
    assert run.main() == 2
    result = json.loads(capsys.readouterr().out)
    assert result["budget"]["projected_dollars"] == 17
    assert result["budget"]["within_ceiling"] is False
    assert result["status"] == "issues_found"
    assert not output.exists() and not (tmp_path / ".unprompted").exists() and not (tmp_path / "data").exists()
    monkeypatch.setattr(budget, "MONTHLY_CEILING", 20)
    assert run.main() == 0
    assert json.loads(capsys.readouterr().out)["status"] == "checks_passed"
    write_json(tmp_path / "data/held" / run.date.today().isoformat() / "alpha.json", {})
    assert run.main() == 2
    assert "already recorded" in " ".join(json.loads(capsys.readouterr().out)["issues"])

    def unreadable():
        raise ValueError("unreadable archive")

    monkeypatch.setattr(budget, "_archived_runs", unreadable)
    assert run.main() == 2
    assert json.loads(capsys.readouterr().out)["budget"] is None


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


def test_recovery_budget_prices_only_new_extraction_without_erasing_prior_spend(monkeypatch):
    from datetime import date
    from unprompted import budget
    from unprompted.cost import cost_of_run
    record = {"category": "alpha", "run_date": date.today().isoformat(), "extractor": "claude-api-extract",
              "extractions": [{"engine": "chatgpt", "error": None, "usage": {
                  "input_tokens": 1_000_000, "extract_input_tokens": 1000, "extract_output_tokens": 500}}]}
    spent = cost_of_run(record)[1]
    extraction_cost = next(i.dollars for i in cost_of_run(record)[0] if i.label == "extract")
    full = budget.estimate_category("alpha", 10, [record])
    reread = budget.estimate_category("alpha", 10, [record], extraction_only=True)
    assert reread.dollars == round(extraction_cost * 10, 2)
    assert full.dollars > reread.dollars > 0
    monkeypatch.setattr(budget, "_archived_runs", lambda: [record])
    monkeypatch.setattr(budget, "MONTHLY_CEILING", spent + (full.dollars + reread.dollars) / 2)
    assert not budget.check("alpha", 10).ok
    verdict = budget.check("alpha", 10, extraction_only=True)
    assert verdict.ok and verdict.spent == spent
    assert "per extraction" in verdict.message
    unpriced = {**record, "extractions": [{"engine": "chatgpt", "usage": {"input_tokens": 1_000_000}}]}
    fallback = budget.estimate_category("alpha", 10, [unpriced], extraction_only=True)
    assert not fallback.confident and fallback.dollars == round(10 * budget.FALLBACK_PER_ANSWER, 2)


def test_reextract_refuses_budget_before_calls(tmp_path, monkeypatch):
    from unprompted import reextract
    from unprompted.models import Extraction
    monkeypatch.setattr(reextract, "ROOT", tmp_path)
    monkeypatch.setattr(reextract, "load_local_env", lambda: None)
    monkeypatch.setattr(reextract, "resolve_extractor", lambda: SimpleNamespace(id="offline", label="offline"))
    def refuse(category, answers, *, extraction_only):
        assert category == "alpha" and answers == 1 and extraction_only is True
        return SimpleNamespace(ok=False, message="offline ceiling")
    monkeypatch.setattr(reextract, "check_budget", refuse)
    monkeypatch.setattr(reextract, "extract_run", lambda *a, **kw: pytest.fail("paid call after refusal"))
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha")
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases/alpha.yml").write_text("canonical: {}")
    write_json(tmp_path / "data/held/2026-09-01/alpha.json", RunRecord("alpha", "2026-09-01", 1, 1, ["offline"],
        extractions=[Extraction("offline", "q1", 0, answer="Alpha")]).to_dict())
    monkeypatch.setattr(run.sys, "argv", ["reextract", "2026-09-01", "--category", "alpha", "--out-date", "2026-09-14"])
    with pytest.raises(SystemExit, match="offline ceiling"):
        reextract.main()


@pytest.mark.parametrize("mode", ["measurement", "recovery"])
def test_alias_edits_during_extraction_do_not_rewrite_provenance(tmp_path, monkeypatch, mode):
    from unprompted import reextract
    from unprompted.models import BrandMention, Extraction
    for module in (run, reextract):
        monkeypatch.setattr(module, "ROOT", tmp_path)
        monkeypatch.setattr(module, "load_local_env", lambda: None)
        monkeypatch.setattr(module, "resolve_extractor", lambda: SimpleNamespace(id="offline", label="offline"))
        monkeypatch.setattr(module, "check_budget", lambda *a, **kw: SimpleNamespace(ok=True, message="offline"))
    (tmp_path / "aliases").mkdir()
    aliases = tmp_path / "aliases/alpha.yml"
    aliases.write_text("canonical:\n  Original: [Old]\n  Beta: []\n")
    (tmp_path / "questions").mkdir()
    questions = tmp_path / "questions/alpha.yml"
    questions.write_text("category: alpha\nmethod_version: 1\nruns_per_question: 1\nmax_brands: 3\nquestions:\n  - id: q1\n    text: Which brand?\n")
    commit = {"sha": "before-calls"}
    for module in (run, reextract):
        monkeypatch.setattr(module, "git_sha", lambda: commit["sha"])

    class Engine:
        name = "offline"
        is_configured = True
        grounds = False

        def ask_one(self, qid, text, index):
            return EngineAnswer(self.name, qid, text, index, text="Old and Beta")

    def configured_engines():
        engine = Engine()
        engine.grounds = commit["sha"] == "after-calls"
        return {"offline": engine}

    for module in (run, reextract):
        monkeypatch.setattr(module, "all_engines", configured_engines)

    def extract(*args, **kwargs):
        aliases.write_text("canonical:\n  Changed: [Old]\n  Beta: []\n")
        questions.write_text(questions.read_text().replace("max_brands: 3", "max_brands: 1"))
        commit["sha"] = "after-calls"
        return [Extraction("offline", "q1", 0, answer="Old and Beta",
            brands=[BrandMention("Old", 1), BrandMention("Beta", 2)])]

    for module in (run, reextract):
        monkeypatch.setattr(module, "extract_run", extract)
    monkeypatch.setattr(run, "write_report", lambda data, root: root / "report.md")
    source = tmp_path / "data/held/2026-09-01/alpha.json"
    if mode == "measurement":
        _, reasons = run.run_category("alpha", "2026-09-14")
        assert not reasons
    else:
        write_json(source, RunRecord("alpha", "2026-09-01", 1, 1, ["offline"], extractions=[
            Extraction("offline", "q1", 0, answer="Old and Beta")]).to_dict())
        original = source.read_bytes()
        monkeypatch.setattr(run.sys, "argv", ["reextract", "2026-09-01", "--category", "alpha", "--out-date", "2026-09-14"])
        assert reextract.main() == 0
        assert source.read_bytes() == original
    saved = json.loads((tmp_path / "data/runs/2026-09-14/alpha.json").read_text())
    assert saved["git_sha"] == "before-calls"
    assert saved["methodology"]["aliases"]["canonical"] == {"Original": ["Old"], "Beta": []}
    assert [b["name"] for b in saved["extractions"][0]["brands"]] == ["Original", "Beta"]


@pytest.mark.parametrize("problem", ["empty", "missing_engine", "missing_row", "duplicate_row", "unexpected_row"])
def test_unrecoverable_population_refuses_before_extractor_resolution(tmp_path, monkeypatch, problem):
    from unprompted import reextract
    from unprompted.models import Extraction
    monkeypatch.setattr(reextract, "ROOT", tmp_path)
    monkeypatch.setattr(reextract, "load_local_env", lambda: None)
    monkeypatch.setattr(reextract, "resolve_extractor", lambda: pytest.fail("extractor resolved for irreparable input"))
    monkeypatch.setattr(reextract, "extract_run", lambda *a, **k: pytest.fail("paid extraction for irreparable input"))
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha")
    record = RunRecord("alpha", "2026-09-01", 1, 2, ["offline"], extractions=[Extraction("offline", "q1", 0, answer="Alpha")]).to_dict()
    if problem == "empty": record["extractions"] = []
    elif problem == "missing_engine": record["engines"].append("absent")
    else:
        record["methodology"] = {"questions": {"questions": [{"id": "q1", "text": "Which?"}]}}
        if problem == "duplicate_row": record["extractions"] *= 2
        if problem == "unexpected_row": record["extractions"].append({**record["extractions"][0], "question_id": "q2", "run_index": 1})
    source = tmp_path / "data/held/2026-09-01/alpha.json"
    write_json(source, record)
    original = source.read_bytes()
    monkeypatch.setattr(run.sys, "argv", ["reextract", "2026-09-01", "--category", "alpha", "--out-date", "2026-09-14"])
    with pytest.raises(SystemExit, match="Cannot recover an incomplete source"):
        reextract.main()
    assert source.read_bytes() == original and not (tmp_path / "data/runs").exists()


def test_recovery_rejects_impossible_reading_dates_before_calls(tmp_path, monkeypatch):
    from datetime import date, timedelta
    from unprompted import reextract
    monkeypatch.setattr(reextract, "ROOT", tmp_path)
    monkeypatch.setattr(reextract, "load_local_env", lambda: None)
    monkeypatch.setattr(reextract, "resolve_extractor", lambda: pytest.fail("extractor reached with invalid dates"))
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha")
    for source, target in [("2026-09-01", "2026-08-31"), ("2026-09-01", "2026-09-01"),
                           ("20260901", "2026-09-14"), ("2026-09-01", "20260914"),
                           ("2026-09-01", (date.today() + timedelta(days=1)).isoformat())]:
        monkeypatch.setattr(run.sys, "argv", ["reextract", source, "--category", "alpha", "--out-date", target])
        with pytest.raises(SystemExit, match="YYYY-MM-DD|rereading date"):
            reextract.main()


def test_recovery_refuses_ambiguous_source_before_calls(tmp_path, monkeypatch):
    from unprompted import reextract
    from unprompted.models import Extraction
    monkeypatch.setattr(reextract, "ROOT", tmp_path)
    monkeypatch.setattr(reextract, "load_local_env", lambda: None)
    monkeypatch.setattr(reextract, "resolve_extractor", lambda: pytest.fail("extractor reached for ambiguous source"))
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha")
    record = RunRecord("alpha", "2026-09-01", 1, 1, ["offline"], extractions=[Extraction("offline", "q1", 0, answer="Alpha")]).to_dict()
    paths = [tmp_path / "data" / bucket / "2026-09-01/alpha.json" for bucket in ("runs", "held")]
    for path in paths:
        write_json(path, record)
    originals = [path.read_bytes() for path in paths]
    monkeypatch.setattr(run.sys, "argv", ["reextract", "2026-09-01", "--category", "alpha", "--out-date", "2026-09-14"])
    with pytest.raises(SystemExit, match="ambiguous source"):
        reextract.main()
    assert [path.read_bytes() for path in paths] == originals


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
    assert not budget.estimate_category("alpha", 10, before).confident
    historical = {"category": "alpha", "run_date": "2026-09-07", "extractions": [
        {"engine": "chatgpt", "usage": {"input_tokens": 2_000_000, "extract_input_tokens": 1000}}]}
    estimate = budget.estimate_category("alpha", 10, [historical, *before])
    assert "2026-09-07" in estimate.basis
    assert budget.spent_in_month(run.date(2026, 9, 14), before) == cost_of_run(before[0])[1]
    final = {k: v for k, v in before[0].items() if k != "checkpoint_only"}
    write_json(tmp_path / "data/held/2026-09-14/alpha.json", final)
    assert budget._archived_runs() == [final]
    assert budget.estimate_category("alpha", 10).confident


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
