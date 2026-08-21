"""Tests for the parts of the pipeline that can be wrong silently.

Engine HTTP calls are not tested here; the retry-and-record behaviour is, using
a stub, because "one dead engine must not cost the week" is a real guarantee.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from unprompted.aggregate import BrandWeek, brand_week, movement, source_counts, the_snub
from unprompted.checks import run_checks
from unprompted.engines.base import Engine
from unprompted.models import BrandMention, EngineAnswer, Extraction
from unprompted.normalize import AliasMap, normalize


ALIASES = AliasMap(
    {
        "PSA": ["psa", "professional sports authenticator", "psa grading"],
        "CGC": ["cgc", "certified guaranty company"],
        "Beckett": ["beckett", "bgs", "beckett grading services"],
    }
)


def ex(engine="claude", qid="q01", run=0, brands=(), refused=False, error=None, sources=()):
    return Extraction(
        engine=engine,
        question_id=qid,
        run_index=run,
        brands=[BrandMention(name=n, position=i) for i, n in enumerate(brands, 1)],
        refused=refused,
        error=error,
        sources=list(sources),
    )


# --- normalize -------------------------------------------------------------

def test_spellings_of_one_brand_collapse_to_one_name():
    cleaned, quarantined = normalize(
        [ex(brands=["psa"]), ex(brands=["PSA Grading"]), ex(brands=["Professional Sports Authenticator"])],
        ALIASES,
    )
    assert [e.brands[0].name for e in cleaned] == ["PSA", "PSA", "PSA"]
    assert quarantined == []


def test_corporate_suffix_is_ignored():
    cleaned, quarantined = normalize([ex(brands=["CGC, LLC"])], ALIASES)
    assert cleaned[0].brands[0].name == "CGC"
    assert quarantined == []


def test_bgs_and_beckett_are_the_same_company():
    cleaned, _ = normalize([ex(brands=["BGS"]), ex(brands=["Beckett"])], ALIASES)
    assert {e.brands[0].name for e in cleaned} == {"Beckett"}


def test_unknown_name_is_quarantined_and_absent_from_output():
    cleaned, quarantined = normalize([ex(brands=["PSA", "Nonexistent Grading Co"])], ALIASES)
    assert [b.name for b in cleaned[0].brands] == ["PSA"]
    assert "Nonexistent Grading Co" in quarantined


def test_positions_are_renumbered_after_removal():
    """A chart must never show a rank that skips a slot."""
    cleaned, _ = normalize([ex(brands=["Fake Co", "PSA", "CGC"])], ALIASES)
    assert [(b.name, b.position) for b in cleaned[0].brands] == [("PSA", 1), ("CGC", 2)]


def test_duplicate_mentions_collapse_to_earliest_position():
    cleaned, _ = normalize([ex(brands=["PSA", "CGC", "psa"])], ALIASES)
    assert [(b.name, b.position) for b in cleaned[0].brands] == [("PSA", 1), ("CGC", 2)]


# --- aggregate -------------------------------------------------------------

def _run(extractions):
    return {"extractions": [e.to_dict() for e in extractions]}


def test_rotation_counts_appearances_over_answered_runs():
    run = _run([ex(run=0, brands=["PSA"]), ex(run=1, brands=["PSA"]), ex(run=2, brands=["CGC"])])
    psa = next(b for b in brand_week(run) if b.brand == "PSA")
    assert psa.named == 2 and psa.total_runs == 3
    assert psa.rotation == pytest.approx(2 / 3, abs=1e-4)


def test_errored_runs_are_excluded_from_the_denominator():
    """An engine outage must not read as brands losing ground."""
    run = _run([ex(run=0, brands=["PSA"]), ex(run=1, error="boom"), ex(run=2, brands=["PSA"])])
    psa = next(b for b in brand_week(run) if b.brand == "PSA")
    assert psa.total_runs == 2
    assert psa.rotation == 1.0


def test_refusals_are_excluded_from_the_denominator():
    run = _run([ex(run=0, brands=["PSA"]), ex(run=1, refused=True)])
    psa = next(b for b in brand_week(run) if b.brand == "PSA")
    assert psa.total_runs == 1


def test_cells_record_one_slot_per_run_in_order():
    """The sequencer row is the signature visual; its cells must be exact."""
    run = _run([ex(run=0, brands=["PSA"]), ex(run=1, brands=["CGC"]), ex(run=2, brands=["PSA"])])
    psa = next(b for b in brand_week(run) if b.brand == "PSA")
    assert psa.cells == [True, False, True]


def test_first_share_leads_ordering_in_a_small_field():
    """Two brands tied on rotation are separated by who gets named first."""
    run = _run([
        ex(run=0, brands=["CGC", "PSA"]),
        ex(run=1, brands=["CGC", "PSA"]),
        ex(run=2, brands=["PSA", "CGC"]),
    ])
    ordered = [b.brand for b in brand_week(run)]
    assert ordered[0] == "CGC"


def test_empty_run_produces_no_standings_rather_than_dividing_by_zero():
    assert brand_week(_run([ex(error="down"), ex(error="down")])) == []


def test_movement_reports_deltas_entrants_and_dropouts():
    last = [BrandWeek("PSA", 5, 5, 1.0, 5, 1.0, 1.0, []), BrandWeek("Beckett", 3, 5, 0.6, 0, 0.0, 2.0, [])]
    this = [BrandWeek("PSA", 4, 5, 0.8, 4, 0.8, 1.0, []), BrandWeek("TAG", 1, 5, 0.2, 0, 0.0, 3.0, [])]
    moves = {m.brand: m for m in movement(this, last)}
    assert moves["PSA"].rotation_delta == pytest.approx(-20.0)
    assert moves["TAG"].is_new
    assert moves["Beckett"].is_dropout
    assert moves["Beckett"].rotation_delta == pytest.approx(-60.0)


def test_the_snub_prefers_a_dropout_over_a_decline():
    last = [BrandWeek("PSA", 5, 5, 1.0, 5, 1.0, 1.0, []), BrandWeek("Beckett", 1, 5, 0.2, 0, 0.0, 2.0, [])]
    this = [BrandWeek("PSA", 2, 5, 0.4, 2, 0.4, 1.0, [])]
    assert the_snub(movement(this, last)).brand == "Beckett"


def test_the_snub_is_none_on_a_quiet_week():
    """Inventing drama from a flat week is how a chart loses trust."""
    week = [BrandWeek("PSA", 5, 5, 1.0, 5, 1.0, 1.0, [])]
    assert the_snub(movement(week, week)) is None


def test_source_counts_group_by_host_and_rank_by_frequency():
    run = _run([
        ex(run=0, brands=["PSA"], sources=["https://www.psacard.com/a", "https://reddit.com/x"]),
        ex(run=1, brands=["PSA"], sources=["https://psacard.com/b"]),
    ])
    assert source_counts(run)[0] == ("psacard.com", 2)


# --- checks ----------------------------------------------------------------

def _week(brand, rotation):
    return BrandWeek(brand, 0, 5, rotation, 0, 0.0, 1.0, [])


def test_clean_run_passes():
    run = _run([ex(run=i, brands=["PSA", "CGC"]) for i in range(5)])
    assert run_checks(run, brand_week(run), []).passed


def test_quarantined_name_holds_the_week():
    run = _run([ex(brands=["PSA"])])
    run["quarantined"] = ["Totally Fake Grading"]
    result = run_checks(run, brand_week(run), [])
    assert result.held and "Totally Fake Grading" in result.reasons[0]


def test_large_rotation_swing_holds_the_week():
    this = [_week("PSA", 0.2), _week("CGC", 0.5)]
    last = [_week("PSA", 0.9), _week("CGC", 0.5)]
    result = run_checks(_run([ex(brands=["PSA"])]), this, last)
    assert result.held and "moved" in " ".join(result.reasons)


def test_small_rotation_swing_passes():
    # Two brands, so this isolates the swing rule instead of also tripping the
    # minimum-brand-count rule.
    this = [_week("PSA", 0.8), _week("CGC", 0.5)]
    last = [_week("PSA", 0.9), _week("CGC", 0.5)]
    assert run_checks(_run([ex(brands=["PSA"])]), this, last).passed


def test_high_error_rate_holds_the_week():
    run = _run([ex(brands=["PSA"])] + [ex(error="boom") for _ in range(4)])
    result = run_checks(run, brand_week(run), [])
    assert result.held and "errored" in " ".join(result.reasons)


def test_too_many_brands_holds_the_week_legacy():
    many = [_week(f"Brand{i}", 0.5) for i in range(20)]
    result = run_checks(_run([ex(brands=["PSA"])]), many, [])
    assert result.held and "outside the expected" in " ".join(result.reasons)


def test_run_with_no_extractions_at_all_holds():
    assert run_checks({"extractions": []}, [], []).held


# --- engine failure behaviour ----------------------------------------------

class _FlakyEngine(Engine):
    name = "flaky"
    key_names = ("UNPROMPTED_TEST_KEY",)

    def __init__(self, fail_always=False):
        self.api_key = "test-key"
        self.fail_always = fail_always
        self.calls = 0

    def _one_call(self, question):
        self.calls += 1
        if self.fail_always:
            raise RuntimeError("engine down")
        return "PSA is the usual choice.", ["https://example.com"]


def test_engine_returns_one_answer_per_run():
    answers = _FlakyEngine().ask("q01", "which grader?", runs=5)
    assert len(answers) == 5 and all(a.ok for a in answers)


def test_engine_failure_is_recorded_not_raised(monkeypatch):
    monkeypatch.setattr("unprompted.engines.base.BACKOFF_SECONDS", 0)
    answers = _FlakyEngine(fail_always=True).ask("q01", "which grader?", runs=2)
    assert len(answers) == 2
    assert all(a.error and not a.ok for a in answers)
    assert "engine down" in answers[0].error


def test_unconfigured_engine_reports_itself_rather_than_failing():
    class _NoKey(Engine):
        name = "nokey"
        key_names = ("DEFINITELY_NOT_SET_XYZ",)

    answers = _NoKey().ask("q01", "which grader?", runs=3)
    assert len(answers) == 3
    assert all("not configured" in a.error for a in answers)


# --- cross-implementation agreement ----------------------------------------
# Rotation is computed twice: here for the sanity checks, and in TypeScript for
# the site. Two implementations of one metric drift silently, and a chart that
# disagrees with its own checks is the failure this project can least afford.
# Both sides assert against the same fixture, so drift in either fails a build.

import json

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_python_matches_the_shared_expectation():
    run = json.loads((FIXTURES / "run-sample.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES / "expected-standings.json").read_text(encoding="utf-8"))

    got = brand_week(run)
    assert [b.brand for b in got] == [e["brand"] for e in expected["standings"]]

    for actual, want in zip(got, expected["standings"]):
        assert actual.named == want["named"]
        assert actual.total_runs == want["totalRuns"]
        assert actual.rotation == pytest.approx(want["rotation"], abs=1e-4)
        assert actual.first_named == want["firstNamed"]
        assert actual.first_share == pytest.approx(want["firstShare"], abs=1e-4)
        assert actual.cells == want["cells"]

    assert source_counts(run)[0] == tuple(expected["topSource"])


def test_parenthetical_forms_resolve_rather_than_quarantine():
    """Engines habitually write "Beckett (BGS)"; both halves are already known."""
    cleaned, quarantined = normalize(
        [ex(brands=["Beckett (BGS)"]), ex(brands=["PSA (Professional Sports Authenticator)"])],
        ALIASES,
    )
    assert [e.brands[0].name for e in cleaned] == ["Beckett", "PSA"]
    assert quarantined == []


def test_parenthetical_with_unknown_halves_still_quarantines():
    cleaned, quarantined = normalize([ex(brands=["Fake Co (FKC)"])], ALIASES)
    assert cleaned[0].brands == []
    assert "Fake Co (FKC)" in quarantined


def test_excluded_names_are_dropped_without_quarantining():
    """Marketplaces and grade labels would otherwise hold every week forever."""
    aliases = AliasMap({"PSA": ["psa"]}, exclude=["eBay", "PSA 10", "Whatnot"])
    cleaned, quarantined = normalize([ex(brands=["PSA", "eBay", "PSA 10"])], aliases)
    assert [b.name for b in cleaned[0].brands] == ["PSA"]
    assert quarantined == []


def test_exclusion_does_not_swallow_genuinely_unknown_names():
    aliases = AliasMap({"PSA": ["psa"]}, exclude=["eBay"])
    _, quarantined = normalize([ex(brands=["Some New Grader"])], aliases)
    assert "Some New Grader" in quarantined


def test_one_mention_tail_does_not_hold_a_healthy_week():
    """The first real run found 24 companies, most named once out of 225."""
    core = [_week(f"Major{i}", 0.5) for i in range(6)]
    tail = [_week(f"Tiny{i}", 0.004) for i in range(18)]
    assert run_checks(_run([ex(brands=["PSA"])]), core + tail, []).passed


def test_too_many_substantial_brands_still_holds():
    many = [_week(f"Brand{i}", 0.5) for i in range(20)]
    result = run_checks(_run([ex(brands=["PSA"])]), many, [])
    assert result.held and "above the" in " ".join(result.reasons)
