"""Brand report: counting, cutoff, escaping and output containment (MONETIZATION-PLAN.md s6)."""
import json
from pathlib import Path

import pytest

from unprompted import brand_report as br
from unprompted.aggregate import brand_week, load_history


def ex(engine, qid, i, brands=(), error=None, refused=False, answer="An answer.", sources=()):
    return {"engine": engine, "question_id": qid, "run_index": i, "error": error, "refused": refused,
            "brands": [{"name": b, "position": p} for p, b in enumerate(brands, 1)],
            "answer": answer, "sources": list(sources), "measurement_git_sha": "m1"}


def run(day, extractions, measured_on=None, version=1):
    return {"category": "alpha", "run_date": day, "measured_on": measured_on or day, "method_version": version,
            "runs_per_question": 1, "engines": ["one", "two"], "git_sha": f"g-{day}", "extractions": extractions,
            "methodology": {"questions": {"questions": [{"id": "q1", "text": "Best tool?"}]}}}


@pytest.fixture
def archive(tmp_path, monkeypatch):
    monkeypatch.setattr(br, "ROOT", tmp_path)
    monkeypatch.setattr(br, "PRIVATE", tmp_path / "private")
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("category: alpha\n")
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases/alpha.yml").write_text("affiliations:\n  Acme: [one]\n")

    def put(record):
        path = tmp_path / "data/runs" / record["run_date"] / "alpha.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record))
    return put


def test_buckets_follow_the_site_and_reject_malformed_flags():
    assert br.bucket(ex("one", "q1", 0, error="boom", refused=True)) == "error"
    assert br.bucket(ex("one", "q1", 0, refused=True)) == "refusal"
    assert br.bucket(ex("one", "q1", 0)) == "answered"          # error: null is normal
    with pytest.raises(ValueError, match="malformed"):
        br.bucket(ex("one", "q1", 0, refused="false"))


def test_counts_once_per_answer_and_never_divide_by_zero():
    rows = [ex("one", "q1", 0, ["Acme", "Beta"]), ex("one", "q1", 1, ["Beta", "Acme"]), ex("one", "q1", 2, [])]
    rows[0]["brands"].append({"name": "Acme", "position": 3})   # duplicate entry
    t = br.tally(rows, "Acme")
    assert (t["n"], t["named"], t["first"], t["median_position"]) == (3, 2, 1, 1.5)
    assert br.tally([], "Acme")["rate"] is None


def test_report_matches_the_pipeline_and_explains_who_is_named_instead(archive):
    archive(run("2026-09-07", [ex("one", "q1", 0, ["Acme"]), ex("two", "q1", 0, ["Beta", "Gamma"]),
                               ex("two", "q1", 1, error="engine failed"), ex("one", "q1", 1, refused=True, answer="")]))
    d = br.analyse("alpha", "Acme")
    expected = next(b for b in brand_week(load_history(br.ROOT / "data/runs", "alpha")[-1]) if b.brand == "Acme")
    assert (d["latest"]["named"], d["latest"]["n"], d["latest"]["first"]) == (expected.named, expected.total_runs, expected.first_named)
    q = d["questions"][0]
    assert q["text"] == "Best tool?" and q["without"] == 1 and q["instead"] == [("Beta", 1), ("Gamma", 1)]
    two = next(e for e in d["engines"] if e["engine"] == "two")
    assert (two["attempted"], two["errors"], two["refusals"], two["n"]) == (2, 1, 0, 1)
    assert d["self_preference"][0]["own_named"] == 1


def test_cutoff_uses_the_latest_reading_of_each_measurement(archive):
    archive(run("2026-09-07", [ex("one", "q1", 0, ["Beta"])]))
    archive(run("2026-09-21", [ex("one", "q1", 0, ["Acme"])], measured_on="2026-09-07"))   # re-reading
    archive(run("2026-09-28", [ex("one", "q1", 0, ["Acme"])]))
    d = br.analyse("alpha", "Acme", through="2026-09-14")
    assert [(w["measured"], w["read"], w["named"]) for w in d["weeks"]] == [("2026-09-07", "2026-09-21", 1)]


def test_weeks_without_the_brand_and_incomparable_weeks_are_shown_not_hidden(archive):
    archive(run("2026-09-07", [ex("one", "q1", 0, ["Acme"])]))
    archive(run("2026-09-14", [ex("one", "q1", 0, ["Beta"])]))
    archive(run("2026-09-21", [ex("one", "q1", 0, ["Acme"])], version=2))
    weeks = br.analyse("alpha", "Acme")["weeks"]
    assert weeks[1]["rank"] is None and weeks[1]["named"] == 0 and weeks[1]["comparable"] is None
    assert "version changed" in weeks[2]["comparable"]
    with pytest.raises(ValueError, match="not named"):
        br.analyse("alpha", "Nobody")


@pytest.mark.parametrize("category", ["../alpha", "al*", "beta"])
def test_only_known_categories_are_read(archive, category):
    with pytest.raises(ValueError, match="unknown category"):
        br.history(category)


@pytest.mark.parametrize("url,safe", [("https://example.com/a?b=1", True), ("javascript:alert(1)", False),
                                      ("https://user:pw@example.com", False), ("https://exa mple.com", False),
                                      ("ftp://example.com", False), ("https://", False)])
def test_only_plain_http_links_become_anchors(url, safe):
    assert br.link(url).startswith("<a ") is safe


def test_hostile_answer_text_is_escaped_and_missing_examples_are_said(archive):
    archive(run("2026-09-07", [ex("one", "q1", 0, ["Acme"], answer='<script>alert("x")</script>'),
                               ex("two", "q1", 0, ["Acme"], answer="  ")]))
    page = br.render(br.analyse("alpha", "Acme"))
    assert "<script>" not in page and "&lt;script&gt;" in page
    assert "Example not recorded." in page


def test_output_stays_inside_private(archive):
    path = br.output_path("alpha", "../../Acme Corp!", "2026-09-07")
    assert path.parent == (br.PRIVATE / "brand" / "alpha").resolve() and path.name == "acme-corp-2026-09-07.html"


def test_counts_agree_with_the_pipeline_on_the_real_archive():
    real = Path(__file__).resolve().parents[1] / "data" / "runs"
    latest = load_history(real, "ai-coding-assistants")[-1]
    top = brand_week(latest)[0]
    d = br.analyse("ai-coding-assistants", top.brand)
    assert (d["latest"]["named"], d["latest"]["n"], d["latest"]["first"]) == (top.named, top.total_runs, top.first_named)
