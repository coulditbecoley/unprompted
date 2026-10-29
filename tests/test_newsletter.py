"""Newsletter draft: only fresh, comparable, beyond-noise movement becomes a headline."""
import json
from datetime import date

import pytest

from unprompted import brand_report as br
from unprompted import newsletter as nl


def run(day, named, total=100, version=1, read=None):
    ex = [{"engine": "one", "question_id": "q1", "run_index": i, "error": None, "refused": False,
           "brands": [{"name": "Acme", "position": 1}] if i < named else [{"name": "Beta", "position": 1}]}
          for i in range(total)]
    return {"category": "alpha", "run_date": read or day, "measured_on": day, "method_version": version,
            "runs_per_question": 1, "engines": ["one"], "extractions": ex}


@pytest.fixture
def archive(tmp_path, monkeypatch):
    for module in (br, nl):
        monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(nl, "PRIVATE", tmp_path / "private")
    (tmp_path / "questions").mkdir()
    (tmp_path / "questions/alpha.yml").write_text("label: Alpha Tools\n")

    def put(record):
        path = tmp_path / "data/runs" / record["run_date"] / "alpha.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record))
    return put


MONDAY = date(2026, 11, 2)


def test_nothing_measured_this_week_says_so(archive):
    archive(run("2026-10-26", 50))
    assert nl.section("alpha", MONDAY)["status"] == nl.NO_MEASUREMENT


def test_a_stale_week_reread_this_week_is_not_presented_as_new(archive):
    archive(run("2026-10-26", 50, read="2026-11-03"))
    assert nl.section("alpha", MONDAY)["status"] == nl.NO_MEASUREMENT


def test_no_comparable_baseline_says_why(archive):
    archive(run("2026-10-26", 50))
    archive(run("2026-11-02", 90, version=2))
    s = nl.section("alpha", MONDAY)
    assert s["status"].startswith(nl.NO_BASELINE) and "version" in s["status"] and not s["movers"]


def test_small_moves_are_not_headlines(archive):
    archive(run("2026-10-26", 50))
    archive(run("2026-11-02", 53))
    s = nl.section("alpha", MONDAY)
    assert s["status"] == nl.NO_MOVEMENT and not s["movers"]


def test_supported_movement_is_the_headline_and_lands_in_private(archive):
    archive(run("2026-10-26", 20))
    archive(run("2026-11-02", 80))
    s = nl.section("alpha", MONDAY)
    assert s["status"] is None and {m.brand for m in s["movers"]} == {"Acme", "Beta"}
    text = nl.render(MONDAY, [s])
    assert "## Alpha Tools" in text and "Acme: +60.0 points" in text and "compared with 2026-10-26" in text


def test_the_latest_measurement_in_the_week_is_compared_with_its_predecessor(archive):
    archive(run("2026-10-26", 20))
    archive(run("2026-11-02", 20))
    archive(run("2026-11-04", 80))
    s = nl.section("alpha", MONDAY)
    assert s["measured"] == "2026-11-04" and s["previous"] == "2026-11-02"
