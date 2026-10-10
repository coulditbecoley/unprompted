"""Offline checks for the shadow Jev reader. The client is always a fake."""
from copy import deepcopy
import hashlib
import json
from types import SimpleNamespace

import pytest

from unprompted import jev_reader
from unprompted.aggregate import brand_week
from unprompted.jev_reader import Finder, questions_for, read_answer, write_shadow
from unprompted.models import EngineAnswer

ALIASES = {
    "canonical": {
        "PSA": ["psa", "professional sports authenticator"],
        "SGC": ["sgc"], "TAG": ["tag grading"], "AGS": ["ags"],
        "Cursor": ["cursor"], "Aider": ["aider"],
        "DALL-E": ["dall-e", "openai image generation"],
    },
    "exclude": ["ChatGPT"],
}


def names(found, source=None):
    return [c.name for c in found if source is None or c.source == source]


def test_candidates_cover_aliases_compounds_and_unknowns():
    text = ("**Best overall:** PSA, then SGC/TAG/Ace for speed. TAG and AGS are cheaper. "
            "OpenAI's image generation and DALL·E both work; skip ChatGPT Plus.\n"
            "- **Kestrel Grading**: new.\n"
            "Read more at [psa.com](https://www.psa.com/cursor-guide) or [kestrel.com](https://kestrel.com).")
    found = Finder(ALIASES).find(text)
    alias = {c.canonical: c for c in found if c.source == "alias"}
    assert set(alias) == {"PSA", "SGC", "TAG", "AGS", "DALL-E"}
    # The fullest spelling names the brand; the first mention fixes its offset.
    assert alias["DALL-E"].name == "OpenAI's image generation"
    assert alias["DALL-E"].offset == text.index("OpenAI's")
    assert alias["TAG"].offset == text.index("TAG/")
    unknown = names(found, "unknown")
    assert "Ace" in unknown and "Kestrel Grading" in unknown       # compound split, bold list head
    assert "ChatGPT Plus" not in unknown                              # excluded name claims its span
    assert "Cursor" not in alias and "kestrel.com" not in unknown     # URLs and domains are citations
    assert not {"Best", "Best overall", "Read"} & set(unknown)        # sentence words are not names
    assert [c.offset for c in found] == sorted(c.offset for c in found)


def test_lowercase_hits_only_when_the_brand_is_never_cased():
    finder = Finder(ALIASES)
    # Lowercase only, so offered; Jev judges whether it is the product.
    assert {c.canonical for c in finder.find("Move the cursor to the end.")} == {"Cursor"}
    common = finder.find("Cursor is best. Move the cursor anywhere.")
    assert [c.offset for c in common if c.canonical == "Cursor"] == [0]
    lowercase_brand = finder.find("Open-source agents like aider are free.")
    assert {c.canonical for c in lowercase_brand} == {"Aider"}


class FakeJev:
    """Answers from fixed tables keyed by candidate name; records every request."""

    def __init__(self, roles, sentiments=None, refused=0.02, fail=None):
        self.roles, self.sentiments, self.refused, self.fail = roles, sentiments or {}, refused, fail
        self.requests = []

    def system_one(self, state, questions, model):
        self.requests.append((state, questions, model))
        if self.fail:
            raise self.fail
        answers = {}
        for qid in questions:
            if qid.startswith(("role_", "sentiment_")):
                kind, index = qid.split("_")
                name = state["candidates"][f"c{int(index):03d}"]
                pick = (self.roles if kind == "role" else self.sentiments).get(
                    name, "not_a_company" if kind == "role" else "neutral")
                answers[qid] = SimpleNamespace(choice=pick, confidence=0.9, probabilities={pick: 0.95})
            else:
                recommends = any(self.roles.get(n) == "option" for n in state["candidates"].values())
                forced = getattr(self, "force_refused", False)
                score = (self.refused if forced or not recommends else 0.02) if qid == "refused" else 0.03
                answers[qid] = SimpleNamespace(noul=score)
        return SimpleNamespace(model="jev-1.13.0", usage=SimpleNamespace(input_tokens=1000), answers=answers)


def answer(text, **kwargs):
    return EngineAnswer(engine="claude", question_id="q1", question="", run_index=0, text=text, **kwargs)


def test_positions_come_from_offsets_and_only_options_are_kept():
    text = "Try SGC first. AGS is fine. Avoid TAG. PSA owns the market."
    fake = FakeJev({"PSA": "option", "AGS": "option", "SGC": "option", "TAG": "avoid"}, {"AGS": "positive"})
    ex, meta = read_answer(fake, answer(text), Finder(ALIASES), question_text="Who grades best?")
    assert [(b.name, b.position) for b in ex.brands] == [("SGC", 1), ("AGS", 2), ("PSA", 3)]
    assert [b.sentiment for b in ex.brands] == ["neutral", "positive", "neutral"]
    assert ex.refused is False and ex.error is None
    assert meta["requests"] == 1 and meta["input_tokens"] == 1000 and meta["model"] == "jev-1.13.0"
    assert {c["name"]: c["role"] for c in meta["candidates"]}["TAG"] == "avoid"
    state, questions, model = fake.requests[0]
    # Untrusted text lives only in state; instructions point at it by key.
    assert set(state) == {"shopper_question", "answer", "candidates"} and model == jev_reader.MODEL
    assert all("SGC" not in json.dumps(q.model_dump()) for q in questions.values())
    assert "off_topic" in questions


def test_refusal_mirrors_the_extraction_prompt():
    empty = FakeJev({}, refused=0.97)
    ex, _ = read_answer(empty, answer("I can't recommend a grader."), Finder(ALIASES))
    assert ex.refused is True and ex.brands == [] and ex.error is None
    conflict = FakeJev({"PSA": "option"}, refused=0.9)
    conflict.force_refused = True
    ex, meta = read_answer(conflict, answer("PSA, I suppose."), Finder(ALIASES))
    assert ex.error == "jev failed: refusal with recommendations" and ex.brands == []
    assert meta["refused"] == 0.9 and meta["candidates"][0]["role"] == "option"
    context_only = FakeJev({"PSA": "context"}, refused=0.1)
    ex, _ = read_answer(context_only, answer("PSA once dominated; today I'd grade elsewhere."), Finder(ALIASES))
    assert ex.refused is False and ex.brands == [] and ex.error is None
    blank, _ = read_answer(FakeJev({}), answer("   "), Finder(ALIASES))
    assert blank.refused is True
    engine_error, meta = read_answer(FakeJev({}), answer("", error="engine timed out"), Finder(ALIASES))
    assert engine_error.error == "engine timed out" and meta["requests"] == 0
    assert "name no companies at all" in questions_for([], False)["refused"].instructions


def test_api_failure_becomes_a_recorded_error_and_a_missing_key_stops_first(monkeypatch):
    from typesafe_sdk import TypeSafeAPIConnectionError

    ex, meta = read_answer(FakeJev({}, fail=TypeSafeAPIConnectionError("down")), answer("PSA."), Finder(ALIASES))
    assert ex.error.startswith("jev failed: TypeSafeAPIConnectionError") and ex.brands == []
    assert not ex.error.startswith("extract failed")               # never mistaken for the published reader's
    bad = FakeJev({"PSA": "option"})
    bad.roles = {"PSA": "invented"}
    ex, _ = read_answer(bad, answer("PSA."), Finder(ALIASES))
    assert "outside the offered options" in ex.error
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="missing or invalid"):
        jev_reader.client()


def test_requests_split_by_candidate_and_stay_under_the_byte_limit(monkeypatch):
    monkeypatch.setattr(jev_reader, "REQUEST_BYTE_LIMIT", 6_000)
    text = " ".join(f"Brand{i:02d} Labs is good." for i in range(12))
    fake = FakeJev({f"Brand{i:02d} Labs": "option" for i in range(12)})
    ex, meta = read_answer(fake, answer(text), Finder(ALIASES))
    assert meta["requests"] > 1 and len(ex.brands) == 12
    for state, questions, _ in fake.requests:
        size = jev_reader._size(state) + sum(jev_reader._size(q) + len(k) for k, q in questions.items())
        assert size <= 6_000
        assert {q.split("_")[1] for q in questions if q.startswith("role_")} ==                {q.split("_")[1] for q in questions if q.startswith("sentiment_")}


def test_an_answer_too_large_for_jev_fails_locally_without_a_request():
    fake = FakeJev({"PSA": "option"})
    ex, meta = read_answer(fake, answer("PSA " + "é" * 30_000), Finder(ALIASES))
    assert ex.error.startswith("jev failed: ValueError: answer too large") and fake.requests == []
    assert meta["requests"] == 0


def run_record(tmp_path):
    rows = [
        {"engine": "claude", "question_id": "q1", "run_index": 0, "answer": "PSA first, then SGC. Avoid TAG.",
         "brands": [{"name": "PSA", "position": 1, "sentiment": "positive"},
                    {"name": "TAG", "position": 2, "sentiment": "neutral"}], "refused": False, "error": None},
        {"engine": "claude", "question_id": "q1", "run_index": 1, "answer": "SGC is best.",
         "brands": [{"name": "SGC", "position": 1, "sentiment": "positive"}], "refused": False, "error": None},
        {"engine": "chatgpt", "question_id": "q1", "run_index": 0, "answer": "No recommendation.",
         "brands": [], "refused": True, "error": None},
        {"engine": "chatgpt", "question_id": "q1", "run_index": 1, "answer": "",
         "brands": [], "refused": False, "error": "engine failed"},
    ]
    record = {"category": "grading", "run_date": "2026-09-14", "engines": ["chatgpt", "claude"],
              "method_version": 1, "runs_per_question": 2, "methodology": {"aliases": ALIASES},
              "extractions": rows, "quarantined": ["Kestrel"]}
    path = tmp_path / "data" / "runs" / "2026-09-14" / "grading.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(record), encoding="utf-8")
    return path, record


def shadow_setup(monkeypatch, tmp_path):
    monkeypatch.setattr(jev_reader, "ROOT", tmp_path)
    monkeypatch.setattr(jev_reader, "SHADOW_ROOT", tmp_path / "audit" / "jev-shadow")


def test_read_record_is_consumable_and_the_shadow_store_is_append_only(monkeypatch, tmp_path):
    shadow_setup(monkeypatch, tmp_path)
    source, record = run_record(tmp_path)
    fake = FakeJev({"PSA": "option", "SGC": "option", "TAG": "avoid"}, {"PSA": "positive"}, refused=0.95)
    reading = jev_reader.read_record(source, fake, workers=1)
    assert reading["reader"] == "jev-1.13.0" and reading["source"] == "data/runs/2026-09-14/grading.json"
    assert reading["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert reading["input_tokens"] == 3000 and reading["errors"] == 0
    by_run = {(e["engine"], e["run_index"]): e for e in reading["extractions"]}
    assert [b["name"] for b in by_run[("claude", 0)]["brands"]] == ["PSA", "SGC"]
    assert by_run[("chatgpt", 0)]["refused"] is True
    assert by_run[("chatgpt", 1)]["error"] == "engine failed"
    week = {b.brand: b for b in brand_week(reading)}
    assert week["SGC"].named == 2 and week["SGC"].total_runs == 2

    target = jev_reader.shadow_path(source, "2026-10-10")
    assert target == tmp_path / "audit/jev-shadow/2026-10-10/runs/2026-09-14/grading.json"
    write_shadow(target, reading)
    with pytest.raises(FileExistsError):
        write_shadow(target, reading)
    for outside in (source, tmp_path / "data" / "runs" / "x.json", tmp_path / "audit" / "other.json"):
        with pytest.raises(ValueError, match="only under"):
            write_shadow(outside, reading)
    assert json.loads(source.read_text(encoding="utf-8")) == record   # the source is untouched


def test_comparison_math_on_a_small_fixture(monkeypatch, tmp_path):
    import scripts.compare_jev as compare_jev

    shadow_setup(monkeypatch, tmp_path)
    source, record = run_record(tmp_path)
    reading = jev_reader.read_record(source, FakeJev({"PSA": "option", "SGC": "option", "TAG": "avoid"},
                                                     {"PSA": "positive"}, refused=0.95), workers=1)
    result = compare_jev.compare(record, reading, "data/runs/2026-09-14/grading.json",
                                 hashlib.sha256(source.read_bytes()).hexdigest())
    claude = result["by_engine"]["claude"]
    # Run 0: Opus {PSA, TAG}, Jev {PSA, SGC}. Run 1: both {SGC}.
    assert claude["compared"] == 2 and claude["first_brand"] == 1.0 and claude["exact_set"] == 0.5
    assert claude["set_overlap"] == round(2 / 4, 4)           # intersections 1+1, unions 3+1
    # Run 1: Opus read SGC as positive, the fake Jev as neutral.
    assert claude["position_of_shared_brands"] == 1.0 and claude["sentiment_flips"] == 1
    assert result["by_engine"]["chatgpt"]["compared"] == 1 and result["by_engine"]["chatgpt"]["refusal"] == 1.0
    assert result["overall"]["not_comparable"] == 1 and result["overall"]["opus_errors"] == 0
    assert result["disagreement_counts"] == {"jev_found_opus_missed": 1, "opus_listed_jev_called_avoid": 1,
                                             "sentiment_flip": 1}
    assert result["disagreements"]["opus_listed_jev_called_avoid"][0]["brand"] == "TAG"
    rotation = {r["brand"]: r for r in result["rotation_changes"]}
    assert rotation["TAG"]["opus"] == 0.5 and rotation["TAG"]["jev"] == 0.0 and rotation["SGC"]["jev"] == 1.0
    assert result["rotation_beyond_noise"] == []               # two answers cannot clear the noise test
    assert result["cost"]["input_tokens"] == 3000 and result["cost"]["answers_read"] == 3
    assert result["label"].startswith("Agreement with the published Opus reading, not accuracy")
    bad = deepcopy(reading)
    bad["source_sha256"] = "0" * 64
    with pytest.raises(ValueError, match="does not belong"):
        compare_jev.compare(record, bad, "data/runs/2026-09-14/grading.json", hashlib.sha256(source.read_bytes()).hexdigest())


def test_review_scores_a_shadow_reading_on_identical_items(monkeypatch, tmp_path):
    from scripts.review_extractions import prepare, score

    shadow_setup(monkeypatch, tmp_path)
    source, _ = run_record(tmp_path)
    packet, _ = prepare(tmp_path, ["data/runs/2026-09-14/grading.json"], 2, "fixed")
    reading = jev_reader.read_record(source, FakeJev({"PSA": "option", "SGC": "option"}, refused=0.95), workers=1)
    shadow = tmp_path / "jev.json"
    shadow.write_text(json.dumps(reading), encoding="utf-8")
    for item in packet["items"]:
        item["review"] = {"reviewer": "fixture", "brands": ["PSA", "SGC"] if item["run_index"] == 0 else ["SGC"],
                          "refused": False, "notes": "synthetic"}
    jev_score = score(tmp_path, packet, [shadow])
    assert jev_score["status"] == "complete" and jev_score["reader"].startswith("shadow readings")
    claude = [d for d in jev_score["disagreements"]]
    assert len(claude) == 1 and claude[0]["predicted"]["refused"] is True    # chatgpt's refusal, labelled not refused
    assert score(tmp_path, packet)["metrics"] != jev_score["metrics"]      # the published reader scores differently
    reading["source_sha256"] = "0" * 64
    shadow.write_text(json.dumps(reading), encoding="utf-8")
    with pytest.raises(ValueError, match="same hash"):
        score(tmp_path, packet, [shadow])


def test_an_excluded_grade_or_compound_still_names_its_brand():
    aliases = {"canonical": {"PSA": ["psa"], "GMA": ["gma"], "Adobe Firefly": ["adobe"]},
               "exclude": ["psa 10", "gma/premier", "adobe photoshop"]}
    found = Finder(aliases).find("A PSA 10 sells best. Budget: GMA/Premier. Edit in Adobe Photoshop.")
    # "a PSA 10" is PSA, as EXTRACT_PROMPT says; an unrelated exclusion implies nothing.
    assert {c.canonical for c in found if c.source == "alias"} == {"PSA", "GMA"}


def test_a_cited_lowercase_label_does_not_rename_the_brand():
    aliases = {"canonical": {"Aider": ["aider", "aider chat"]}, "exclude": []}
    found = Finder(aliases).find("Best terminal tool: Aider. ([aider.chat](https://aider.chat/docs))")
    assert [(c.name, c.offset) for c in found if c.source == "alias"] == [("Aider", 20)]


def test_reading_sets_are_named_explicitly_and_never_replace_each_other(monkeypatch, tmp_path):
    shadow_setup(monkeypatch, tmp_path)
    source, _ = run_record(tmp_path)
    first = jev_reader.shadow_path(source, "2026-10-10")
    second = jev_reader.shadow_path(source, "2026-10-10-r2")
    assert first == tmp_path / "audit/jev-shadow/2026-10-10/runs/2026-09-14/grading.json"
    write_shadow(first, {"n": 1})
    write_shadow(second, {"n": 2})
    with pytest.raises(FileExistsError):
        write_shadow(first, {"n": 3})
    assert json.loads(first.read_text(encoding="utf-8")) == {"n": 1}
    for bad in ("latest", "../2026-10-10", "2026-10-10/x", "2026-10-10-v2", "runs"):
        with pytest.raises(ValueError):
            jev_reader.shadow_path(source, bad)


def test_shadow_readings_are_gitignored_so_published_git_sha_stays_clean():
    import subprocess
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    probe = "audit/jev-shadow/2026-10-12/runs/2026-10-12/ai-coding-assistants.json"
    assert subprocess.run(["git", "check-ignore", "-q", probe], cwd=root).returncode == 0
    assert subprocess.run(["git", "check-ignore", "-q", "audit/2026-10-10/jev-shadow-report.md"], cwd=root).returncode == 1


def test_compare_refuses_a_partial_set_and_an_existing_output(monkeypatch, tmp_path):
    import sys
    import scripts.compare_jev as compare_jev

    shadow_setup(monkeypatch, tmp_path)
    monkeypatch.setattr(compare_jev, "ROOT", tmp_path)
    run_record(tmp_path)
    monkeypatch.setattr(sys, "argv", ["compare_jev.py", "compare", "--set", "2026-10-10"])
    with pytest.raises(SystemExit, match="has no reading of: data/runs/2026-09-14/grading.json"):
        compare_jev.main()
    existing = tmp_path / "out.json"
    existing.write_text("{}")
    def must_not_read(*args):
        raise AssertionError("read before checking the output path")
    monkeypatch.setattr(compare_jev, "_load_or_read", must_not_read)
    monkeypatch.setattr(sys, "argv", ["compare_jev.py", "compare", "--set", "2026-10-10", "--out", str(existing)])
    with pytest.raises(SystemExit, match="already exists"):
        compare_jev.main()


def test_an_unknown_name_keeps_its_earliest_mention():
    found = Finder(ALIASES).find("Kestrel Grading works. Try SGC next. **Kestrel Grading** is cheap.")
    assert [(c.name, c.offset) for c in found] == [("Kestrel Grading", 0), ("SGC", 27)]


def test_a_tier_on_the_exclude_list_names_its_brand_but_a_product_does_not():
    aliases = {"canonical": {"CGC": ["cgc"], "PSA": ["psa"], "Beckett": ["bgs"], "Adobe Firefly": ["adobe"]},
               "exclude": ["cgc bulk", "psa 10", "bgs pristine 10", "adobe photoshop"]}
    found = Finder(aliases).find("CGC Bulk is best. PSA is next. BGS Pristine 10 is rare. Use Adobe Photoshop.")
    assert [(c.canonical, c.offset) for c in found if c.source == "alias"] == [
        ("CGC", 0), ("PSA", 18), ("Beckett", 31)]


def test_the_known_lowercase_limit_is_unchanged():
    # Documented limit: a lowercase product mention before a capitalised one
    # takes the capitalised offset. 1 of 3,926 archived answers is affected.
    found = Finder(ALIASES).find("Try aider first, Cursor second. Aider is free.")
    assert [(c.canonical, c.offset) for c in found if c.source == "alias"] == [("Cursor", 17), ("Aider", 32)]
    noun = Finder(ALIASES).find("Friendly cursor here. Cursor is recommended.")
    assert [(c.canonical, c.offset) for c in noun if c.source == "alias"] == [("Cursor", 22)]


def test_quarantine_matches_are_labelled_possible_and_are_stable(monkeypatch, tmp_path):
    import scripts.compare_jev as compare_jev

    shadow_setup(monkeypatch, tmp_path)
    source, record = run_record(tmp_path)
    record["extractions"][0]["answer"] = "PSA first, then SGC Plus or SGC Mail. Avoid TAG."
    record["quarantined"] = ["SGC Plus", "SGC Mail"]          # equal length: order must not depend on hashing
    source.write_text(json.dumps(record), encoding="utf-8")    # source and reading built from the same answer
    shadow = jev_reader.read_record(source, FakeJev({"PSA": "option", "SGC": "option"}), workers=1)
    result = compare_jev.compare(record, shadow, "data/runs/2026-09-14/grading.json")
    match = result["disagreements"]["jev_found_possible_quarantine_match"][0]
    assert match["possible_quarantined_name"] == "SGC Mail"
    assert "jev_found_opus_likely_quarantined_longer_name" not in result["disagreements"]


def test_rotation_uses_each_readings_usable_answers():
    import scripts.compare_jev as compare_jev

    def run(brands, error=None):
        return {"category": "grading", "extractions": [
            {"engine": "e", "question_id": "q1", "run_index": i, "refused": False, "error": error,
             "brands": [{"name": n, "position": 1} for n in brands]} for i in range(40)]}
    assert compare_jev._rotation(run([]), run(["PSA"])) == [
        {"brand": "PSA", "opus": 0.0, "jev": 1.0, "delta_points": 100.0, "exceeds_noise": True}]
    assert compare_jev._rotation(run(["PSA"]), run([]))[0]["exceeds_noise"] is True
    assert compare_jev._rotation(run(["PSA"], "extract failed: x"), run(["PSA"])) == "no usable Opus reading to compare"
    assert compare_jev._rotation(run(["PSA"]), run(["PSA"], "jev failed: x")) == "no usable Jev reading to compare"


@pytest.mark.parametrize("damage", ["duplicate_row", "changed_answer", "duplicate_name", "bad_position",
                                    "missing_name", "two_readings"])
def test_review_rejects_duplicate_altered_or_malformed_shadow_rows(monkeypatch, tmp_path, damage):
    from scripts.review_extractions import prepare, shadow_predictions

    shadow_setup(monkeypatch, tmp_path)
    source, _ = run_record(tmp_path)
    packet, _ = prepare(tmp_path, ["data/runs/2026-09-14/grading.json"], 2, "fixed")
    shadow = jev_reader.read_record(source, FakeJev({"PSA": "option", "SGC": "option"}), workers=1)
    first = shadow["extractions"][0]
    if damage == "duplicate_row":
        extra = deepcopy(first)
        extra["brands"] = [{"name": "Invented", "position": 1, "sentiment": "neutral"}]
        shadow["extractions"].append(extra)
    if damage == "changed_answer":
        first["answer"] = "A completely different answer."
    if damage == "duplicate_name":
        first["brands"] = [{"name": "PSA", "position": 1}, {"name": "PSA", "position": 2}]
    if damage == "bad_position":
        first["brands"] = [{"name": "PSA", "position": 0}]
    if damage == "missing_name":
        first["brands"] = [{"position": 1}]
    paths = [tmp_path / "jev.json"]
    paths[0].write_text(json.dumps(shadow), encoding="utf-8")
    if damage == "two_readings":
        paths.append(tmp_path / "jev-copy.json")
        paths[1].write_text(json.dumps(shadow), encoding="utf-8")
    with pytest.raises(ValueError):
        shadow_predictions(tmp_path, packet, paths)


def test_probes_save_auditable_per_sample_results(monkeypatch, tmp_path):
    import hashlib
    import scripts.compare_jev as compare_jev

    shadow_setup(monkeypatch, tmp_path)
    monkeypatch.setattr(compare_jev, "ROOT", tmp_path)
    source, _ = run_record(tmp_path)
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases" / "ai-coding-assistants.yml").write_text("canonical: {Cursor: [cursor]}\n")
    fake = FakeJev({"PSA": "option", "SGC": "option", "TAG": "avoid"})
    write_shadow(jev_reader.shadow_path(source, "2026-10-10"), jev_reader.read_record(source, fake, workers=1))
    result = compare_jev.probes("2026-10-10", fake, sample=3, seed="fixed")
    assert result["option_order"]["judgments"] > 0
    assert result["option_order"]["same_role"] == result["option_order"]["judgments"]
    sample = result["samples"][0]
    assert sample["source"] == "data/runs/2026-09-14/grading.json" and "original" in sample and "reversed" in sample
    assert result["source_hashes"]["data/runs/2026-09-14/grading.json"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert set(result["planted"]) == {"plain", "quoted page", "direct", "refusal", "off topic"}
    role_questions = [q for s, qs, _ in fake.requests for k, q in qs.items() if k.startswith("role_")]
    assert any(list(q.criteria)[0] == "not_a_company" for q in role_questions)
    again = compare_jev.probes("2026-10-10", fake, sample=3, seed="fixed")
    assert [s["run_index"] for s in again["samples"]] == [s["run_index"] for s in result["samples"]]
