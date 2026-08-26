"""Tests for the parts of the pipeline that can be wrong silently.

Engine HTTP calls are not tested here; the retry-and-record behaviour is, using
a stub, because "one dead engine must not cost the week" is a real guarantee.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from unprompted.aggregate import BrandWeek, brand_week, movement, source_counts, the_snub
from unprompted.checks import MAX_ERROR_RATE, run_checks
from unprompted.engines.base import Engine
from unprompted.models import BrandMention, EngineAnswer, Extraction, RunRecord
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
        return (
            "PSA is the usual choice.",
            ["https://example.com"],
            {"input_tokens": 120, "output_tokens": 40, "web_searches": 1},
        )


def test_engine_returns_one_answer_per_run():
    answers = _FlakyEngine().ask("q01", "which grader?", runs=5)
    assert len(answers) == 5 and all(a.ok for a in answers)


def test_engine_records_usage_so_cost_is_measured_not_guessed():
    answer = _FlakyEngine().ask("q01", "which grader?", runs=1)[0]
    assert answer.usage["input_tokens"] == 120
    assert answer.usage["output_tokens"] == 40
    assert answer.usage["web_searches"] == 1


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
        for got_step, want_step in zip(actual.steps, want["steps"]):
            assert got_step == pytest.approx(want_step, abs=1e-4)
        assert len(actual.steps) == len(want["steps"])

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


def test_dash_separated_forms_resolve():
    """Answers write "AGS - Automated Grading Systems" with any kind of dash."""
    aliases = AliasMap({"AGS": ["ags", "automated grading systems"]})
    cleaned, quarantined = normalize(
        [ex(brands=["AGS – Automated Grading Systems"]), ex(brands=["AGS - Automated Grading Systems"])],
        aliases,
    )
    assert [e.brands[0].name for e in cleaned] == ["AGS", "AGS"]
    assert quarantined == []


def test_a_single_stray_unknown_name_does_not_hold_the_week():
    """Otherwise the chart never publishes itself, which is the whole point.

    Sized like a real week: one mention against 100 answered runs is 1%, under
    the 2% floor. In production the ratio is 1 in 225.
    """
    run = _run([ex(run=i, brands=["PSA", "CGC"]) for i in range(100)])
    run["quarantined"] = ["Some Random Hobby Shop"]
    assert run_checks(run, brand_week(run), []).passed


def test_a_repeated_unknown_name_still_holds_the_week():
    run = _run([ex(run=i, brands=["PSA", "CGC"]) for i in range(50)])
    run["quarantined"] = ["New Grader Co"] * 20
    result = run_checks(run, brand_week(run), [])
    assert result.held and "New Grader Co" in " ".join(result.reasons)


# --- self-preference --------------------------------------------------------

def test_self_preference_measures_owner_against_rivals():
    """The reason the AI-tools category exists."""
    from unprompted.aggregate import self_preference

    run = _run([
        ex(engine="claude", run=0, brands=["Claude Code"]),
        ex(engine="claude", run=1, brands=["Claude Code"]),
        ex(engine="chatgpt", run=0, brands=["Cursor"]),
        ex(engine="chatgpt", run=1, brands=["Cursor"]),
    ])
    result = {s.brand: s for s in self_preference(run, {"Claude Code": "claude"})}
    cc = result["Claude Code"]
    assert cc.own_rate == 1.0 and cc.own_runs == 2
    assert cc.rival_rate == 0.0 and cc.rival_runs == 2
    assert cc.gap == 100.0


def test_no_self_preference_when_everyone_names_it_equally():
    from unprompted.aggregate import self_preference

    run = _run([
        ex(engine="claude", run=0, brands=["Claude Code"]),
        ex(engine="chatgpt", run=0, brands=["Claude Code"]),
    ])
    assert self_preference(run, {"Claude Code": "claude"})[0].gap == 0.0


def test_self_preference_skips_a_brand_with_no_rival_data():
    """One engine alone cannot evidence favouritism, so report nothing."""
    from unprompted.aggregate import self_preference

    run = _run([ex(engine="claude", run=0, brands=["Claude Code"])])
    assert self_preference(run, {"Claude Code": "claude"}) == []


def test_max_brands_is_per_category():
    """Grading has five real companies; AI coding tools genuinely has eighteen."""
    wide = [_week(f"Tool{i}", 0.3) for i in range(18)]
    run = _run([ex(brands=["PSA"])])
    assert run_checks(run, wide, []).held          # default bound of 15
    assert run_checks(run, wide, [], max_brands=25).passed


# --- cost -------------------------------------------------------------------

def test_cost_is_computed_from_reported_usage():
    from unprompted.cost import cost_of_run

    run = {
        "extractions": [
            {
                "engine": "claude",
                "usage": {"input_tokens": 1_000_000, "output_tokens": 100_000, "web_searches": 4},
            },
            {
                "engine": "perplexity",
                "usage": {"input_tokens": 1_000_000, "output_tokens": 1_000_000, "requests": 1},
            },
        ]
    }
    items, total = cost_of_run(run)
    by = {i.label: i for i in items}
    # claude: $5 in + $2.50 out + 4 searches at $0.01
    assert round(by["claude"].dollars, 3) == 7.540
    # perplexity: $1 in + $1 out + one request at $0.005
    assert round(by["perplexity"].dollars, 3) == 2.005
    assert round(total, 3) == 9.545


def test_runs_without_usage_report_zero_rather_than_a_guess():
    """A missing measurement should look missing."""
    from unprompted.cost import cost_of_run

    _, total = cost_of_run({"extractions": [{"engine": "claude"}]})
    assert total == 0.0


def test_every_module_imports():
    """A syntax error in an entry point is invisible to unit tests that never
    import it, and would only surface on the scheduled run. This catches it."""
    import importlib

    for name in (
        "unprompted.aggregate",
        "unprompted.checks",
        "unprompted.cost",
        "unprompted.extract",
        "unprompted.models",
        "unprompted.normalize",
        "unprompted.reextract",
        "unprompted.run",
        "unprompted.engines",
        "unprompted.engines.anthropic_engine",
        "unprompted.engines.openai_engine",
        "unprompted.engines.perplexity_engine",
    ):
        importlib.import_module(name)


REPO = Path(__file__).resolve().parents[1]


def test_report_renders_without_em_dashes():
    """The weekly note is synced into a vault whose house style forbids them.

    Doubles as the cheapest guard that the renderer runs at all: the sample run
    exercises standings, movement and the source list in one pass.
    """
    from unprompted.report import build_report, pretty

    run = _run([
        ex(brands=["PSA", "CGC"], sources=["https://psacard.com/a"]),
        ex(run=1, brands=["CGC"]),
    ])
    run.update(
        category="ai-coding-assistants",
        run_date="2026-08-22",
        method_version=1,
        runs_per_question=5,
        engines=["chatgpt", "claude", "perplexity"],
    )
    text = build_report(run, [run], REPO / "aliases" / "ai-coding-assistants.yml")

    assert "—" not in text
    assert text.startswith("---" + chr(10))
    assert "## Standings" in text
    assert "PSA" in text
    assert pretty("ai-coding-assistants") == "AI Coding Assistants"


def test_every_runnable_category_has_its_alias_map():
    """The runner picks categories up from questions/; a missing alias map there
    would quarantine every brand and hold the week for no good reason."""
    from unprompted.run import all_categories

    slugs = all_categories()
    assert slugs, "no question banks found"
    for slug in slugs:
        assert (REPO / "aliases" / f"{slug}.yml").exists(), f"{slug} has no aliases"


def test_recorded_usage_reaches_the_cost_report():
    """A run that used tokens must not report $0.00.

    The cost plumbing was once complete except for one field, so every run
    reported itself as free. A silent zero is worse than no report at all.
    """
    from unprompted.cost import cost_of_run

    run = _run([
        ex(engine="claude", brands=["PSA"]),
        ex(engine="chatgpt", run=1, brands=["CGC"]),
    ])
    for extraction in run["extractions"]:
        extraction["usage"] = {
            "input_tokens": 20_000,
            "output_tokens": 500,
            "web_searches": 4,
            "extract_input_tokens": 1_500,
            "extract_output_tokens": 120,
        }

    items, total = cost_of_run(run)
    assert total > 0
    labels = {item.label for item in items}
    assert {"claude", "chatgpt", "extract"} <= labels


def test_json_is_recovered_from_a_chatty_cli_reply():
    """A CLI has no schema enforcement, so its wrapping has to be tolerated.

    Fences and a leading sentence are both normal output; treating either as a
    parse failure would throw away a perfectly good extraction.
    """
    from unprompted.cli_provider import ProviderError, parse_json_reply

    body = '{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}'

    assert parse_json_reply(body)["brands"][0]["name"] == "Midjourney"
    assert parse_json_reply("Here you go:\n```json\n" + body + "\n```")["refused"] is False
    assert parse_json_reply("Sure. " + body + " Hope that helps.")["refused"] is False

    with pytest.raises(ProviderError):
        parse_json_reply("I could not read that answer.")


def test_a_cli_provider_refuses_an_unsafe_command():
    """The registry is a file on disk, so the executing side re-checks it.

    The admin route validates the same shape, but a hand edit never passes
    through the route at all.
    """
    from unprompted.cli_provider import CliProvider, ProviderError

    with pytest.raises(ProviderError):
        CliProvider("bad", "Bad", "claude; rm -rf /", ()).resolve()
    with pytest.raises(ProviderError):
        CliProvider("bad", "Bad", "../../evil", ()).resolve()


def test_registry_picks_one_enabled_cli_extractor():
    """Two enabled extractors would make the week depend on which one ran."""
    from unprompted.cli_provider import cli_extractor

    chosen = cli_extractor()
    if chosen is not None:
        assert chosen.command
        assert chosen.args


# --- the publish gate -------------------------------------------------------
#
# The rule these cover: a run that fails its checks must not reach data/runs,
# because the weekly workflow commits everything under data/. A 100%-error week
# once published as "no brand was named" because the checks ran, returned their
# reasons, and were then ignored by the writer.

def test_a_held_run_is_written_outside_the_published_directory(tmp_path, monkeypatch):
    from unprompted import run as run_module

    monkeypatch.setattr(run_module, "ROOT", tmp_path)
    record = RunRecord(
        category="ai-coding-assistants",
        run_date="2026-09-01",
        method_version=1,
        runs_per_question=15,
        engines=["chatgpt"],
        extractions=[ex(run=0, brands=["PSA"])],
    )

    run_module.persist(record, ["37% of engine calls errored"])

    assert not (tmp_path / "data" / "runs" / "2026-09-01").exists()
    assert (tmp_path / "data" / "held" / "2026-09-01" / "ai-coding-assistants.json").exists()
    # No report either: the report is the published artefact.
    assert not (tmp_path / "reports").exists()


def test_a_passing_run_is_written_where_the_site_reads(tmp_path, monkeypatch):
    from unprompted import run as run_module

    monkeypatch.setattr(run_module, "ROOT", tmp_path)
    # The report reads the category's alias map for the affiliations block.
    (tmp_path / "aliases").mkdir()
    (tmp_path / "aliases" / "ai-coding-assistants.yml").write_text(
        "canonical:\n  PSA: []\n", encoding="utf-8"
    )
    record = RunRecord(
        category="ai-coding-assistants",
        run_date="2026-09-01",
        method_version=1,
        runs_per_question=15,
        engines=["chatgpt"],
        extractions=[ex(run=0, brands=["PSA"])],
    )

    run_module.persist(record, [])

    assert (tmp_path / "data" / "runs" / "2026-09-01" / "ai-coding-assistants.json").exists()
    assert not (tmp_path / "data" / "held").exists()


# --- quarantine frequency ---------------------------------------------------

def test_the_record_keeps_every_quarantined_occurrence():
    """checks.py counts occurrences to decide whether a name is material.

    Serialising through a set capped every count at 1, so the frequency rule
    could never fire in production no matter how often a name appeared. The
    hand-built dictionary in the check's own test missed it, because it never
    passed through RunRecord.
    """
    record = RunRecord(
        category="c",
        run_date="2026-09-01",
        method_version=1,
        runs_per_question=15,
        engines=["chatgpt"],
        quarantined=["New Grader Co"] * 20 + ["One Off Shop"],
    )
    assert record.to_dict()["quarantined"].count("New Grader Co") == 20


def test_a_repeated_unknown_holds_the_week_through_a_real_record():
    """The end-to-end version of the rule above, with no hand-built dict."""
    record = RunRecord(
        category="c",
        run_date="2026-09-01",
        method_version=1,
        runs_per_question=15,
        engines=["chatgpt"],
        extractions=[ex(run=i, brands=["PSA", "CGC"]) for i in range(50)],
        quarantined=["New Grader Co"] * 20,
    )
    data = record.to_dict()
    result = run_checks(data, brand_week(data), [])
    assert result.held and "New Grader Co" in " ".join(result.reasons)


# --- the zero-brand hole ----------------------------------------------------

def test_a_run_where_every_answer_refused_is_held():
    """No errors, no quarantine, no brands: it passed every rule and published.

    A refusal is a real outcome, but a board with nothing on it is a system
    failure until a human says otherwise.
    """
    run = _run([ex(run=i, refused=True) for i in range(50)])
    assert run_checks(run, brand_week(run), []).held


def test_a_run_that_names_nothing_at_all_is_held():
    run = _run([ex(run=i, brands=[]) for i in range(50)])
    assert run_checks(run, brand_week(run), []).held


# --- extractor availability -------------------------------------------------

def test_an_available_cli_extractor_is_still_selected(monkeypatch):
    from unprompted import cli_provider

    monkeypatch.setattr(cli_provider.shutil, "which", lambda cmd: f"/usr/bin/{cmd}")
    monkeypatch.setattr(
        cli_provider,
        "load_registry",
        lambda: [
            {
                "id": "claude-cli",
                "kind": "cli",
                "role": "extractor",
                "enabled": True,
                "command": "claude",
                "args": ["-p", "--strict-mcp-config"],
            }
        ],
    )
    chosen = cli_provider.cli_extractor()
    assert chosen is not None and chosen.id == "claude-cli"


def test_a_cli_entry_with_rewritten_arguments_is_refused(monkeypatch):
    """The command name was never the risk; the arguments are.

    `python -c "..."` passes any plain-executable-name check and is a program.
    The registry is a file on disk, so the executing side re-checks both halves
    against the allowlist rather than trusting whatever committed it.
    """
    from unprompted.cli_provider import CliProvider, ProviderError

    monkeypatch.setattr("shutil.which", lambda cmd: f"/usr/bin/{cmd}")

    with pytest.raises(ProviderError):
        CliProvider("evil", "Evil", "python", ("-c", "import os; os.system('id')")).resolve()
    with pytest.raises(ProviderError):
        # A known command with substituted arguments is refused too.
        CliProvider("evil", "Evil", "claude", ("--dangerously-skip-permissions",)).resolve()


# --- the two halves of the CLI allowlist ------------------------------------

def test_the_python_and_typescript_cli_allowlists_agree():
    """lib/providers.ts validates what may be committed; cli_provider.py runs it.

    If the two drift, the admin dashboard accepts an entry the pipeline then
    refuses, or worse, pins weaker arguments than the ones that were reviewed.
    The arguments are the harness's safety settings, so this is a security
    boundary and not merely tidiness.
    """
    import json
    import re

    from unprompted.cli_provider import ALLOWED_CLIS

    root = Path(__file__).resolve().parents[1]
    ts = (root / "lib" / "providers.ts").read_text(encoding="utf-8")
    block = re.search(r"KNOWN_CLIS[^=]*=\s*\[(.*?)\n\];", ts, re.S)
    assert block, "could not find KNOWN_CLIS in lib/providers.ts"

    # Strip line comments and trailing commas so the arrays parse as JSON.
    body = re.sub(r"//[^\n]*", "", block.group(1))
    found = {
        command: json.loads(re.sub(r",(\s*\])", r"\1", args))
        for command, args in re.findall(
            r'command:\s*"([^"]+)",\s*args:\s*(\[[^\]]*\])', body, re.S
        )
    }
    assert found, "could not parse any CLI entries from lib/providers.ts"
    assert found == {k: list(v) for k, v in ALLOWED_CLIS.items()}


def test_every_registered_cli_provider_is_on_the_allowlist():
    """providers.json is committed from the dashboard and editable by hand."""
    import json

    from unprompted.cli_provider import ALLOWED_CLIS

    root = Path(__file__).resolve().parents[1]
    registry = json.loads((root / "providers.json").read_text(encoding="utf-8"))
    for entry in registry["providers"]:
        if entry.get("kind") != "cli":
            continue
        command = entry.get("command")
        assert command in ALLOWED_CLIS, f"{entry['id']}: {command} is not allowlisted"
        assert tuple(entry.get("args") or ()) == ALLOWED_CLIS[command], (
            f"{entry['id']}: args do not match the pinned allowlist"
        )


def test_the_extractor_environment_carries_no_secrets(monkeypatch):
    """The prompt is untrusted text; the pipeline's environment holds every key."""
    from unprompted.cli_provider import _child_env

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("PERPLEXITY_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("GITHUB_TOKEN", "ghp-should-not-leak")

    env = _child_env()
    assert not [v for v in env.values() if "should-not-leak" in v]
    # Still usable: the harness needs to be findable and to locate its own auth.
    assert "PATH" in env


def test_the_run_record_names_the_extractor_that_read_it():
    """More than one local harness can be registered, and the pipeline falls
    through to the next that resolves. Which one read a given week is therefore
    not a constant, and is not recoverable from anywhere else in the record."""
    record = RunRecord(
        category="c",
        run_date="2026-09-01",
        method_version=1,
        runs_per_question=15,
        engines=["chatgpt"],
        extractor="codex-cli",
    )
    assert record.to_dict()["extractor"] == "codex-cli"
    # Runs that never configured a local harness say so rather than being blank.
    assert RunRecord("c", "2026-09-01", 1, 15, ["chatgpt"]).to_dict()["extractor"] == "api"


# --- local CLI engines ------------------------------------------------------

def test_a_cli_engine_answers_and_reports_no_citations(monkeypatch):
    """A CLI prints prose on stdout and nothing else.

    Empty sources are correct rather than missing: the hosted engines return the
    pages their search actually used, and a harness has no equivalent to report.
    """
    from unprompted.cli_provider import CliProvider
    from unprompted.engines.cli_engine import CliEngine

    provider = CliProvider("claude-code", "Claude Code", "claude", ("-p",))
    monkeypatch.setattr(CliProvider, "resolve", lambda self: "/usr/bin/claude")
    monkeypatch.setattr(CliProvider, "ask", lambda self, prompt: "Try Cursor, then Copilot.")

    answer = CliEngine(provider).ask_one("q01", "best coding assistant?", 0)
    assert answer.engine == "claude-code"
    assert "Cursor" in answer.text
    assert answer.sources == []
    assert answer.usage == {}
    assert answer.error is None


def test_a_cli_engine_that_is_not_installed_says_so_rather_than_blaming_a_key():
    from unprompted.cli_provider import CliProvider
    from unprompted.engines.cli_engine import CliEngine

    engine = CliEngine(CliProvider("ghost", "Ghost", "claude", ("-p",)))
    # Same command, but nothing resolves it in this test environment unless the
    # harness happens to be installed, so assert on the wording, not the result.
    assert "not on PATH" in engine.unavailable_reason


def test_a_declared_cli_engine_joins_the_registry(monkeypatch):
    from unprompted import cli_provider
    from unprompted.engines import all_engines

    monkeypatch.setattr(cli_provider.shutil, "which", lambda cmd: f"/usr/bin/{cmd}")
    monkeypatch.setattr(
        cli_provider,
        "load_registry",
        lambda: [
            {
                "id": "claude-code",
                "kind": "cli",
                "role": "engine",
                "enabled": True,
                "command": "claude",
                "args": ["-p", "--strict-mcp-config"],
            },
            # An extractor must not be mistaken for an engine.
            {
                "id": "codex-cli",
                "kind": "cli",
                "role": "extractor",
                "enabled": True,
                "command": "codex",
                "args": list(cli_provider.ALLOWED_CLIS["codex"]),
            },
        ],
    )
    names = set(all_engines())
    assert "claude-code" in names
    assert "codex-cli" not in names
    # The hosted three are the definition of the series and are always present.
    assert {"chatgpt", "claude", "perplexity"} <= names


def test_a_vendor_with_two_engines_is_not_its_own_rival():
    """Anthropic answers as both `claude` and `claude-code`.

    Counting the second as a neutral rival of the first would shrink the very
    self-preference gap this publication exists to measure.
    """
    from unprompted.aggregate import self_preference

    answers = (
        [ex(engine="claude", run=i, brands=["Claude Code"]) for i in range(10)]
        + [ex(engine="claude-code", run=i, brands=["Claude Code"]) for i in range(10)]
        + [ex(engine="perplexity", run=i, brands=[]) for i in range(10)]
    )
    run = _run(answers)

    both = self_preference(run, {"Claude Code": ["claude", "claude-code"]})[0]
    assert both.own_runs == 20 and both.own_rate == 1.0
    assert both.rival_runs == 10 and both.rival_rate == 0.0
    assert both.gap == 100.0

    # Naming only the hosted engine hides half the vendor's own answers in the
    # rival bucket, and the measured gap collapses.
    one = self_preference(run, {"Claude Code": ["claude"]})[0]
    assert one.rival_runs == 20
    assert one.gap < both.gap


def test_a_single_owner_string_still_works():
    """Older alias files name one engine; they must keep parsing."""
    from unprompted.aggregate import self_preference

    run = _run(
        [ex(engine="claude", run=i, brands=["Claude Code"]) for i in range(5)]
        + [ex(engine="perplexity", run=i, brands=[]) for i in range(5)]
    )
    assert self_preference(run, {"Claude Code": "claude"})[0].gap == 100.0


def test_adding_an_engine_without_a_method_bump_holds_the_week():
    """Registering a local harness as an engine is exactly this case."""
    previous = {
        "engines": ["chatgpt", "claude", "perplexity"],
        "method_version": 1,
    }
    run = _run([ex(engine="claude", run=i, brands=["PSA", "CGC"]) for i in range(50)])
    run["engines"] = ["chatgpt", "claude", "claude-code", "perplexity"]
    run["method_version"] = 1

    result = run_checks(run, brand_week(run), [], previous=previous)
    assert result.held
    assert "claude-code" in " ".join(result.reasons)


def test_adding_an_engine_with_a_method_bump_passes():
    previous = {
        "engines": ["chatgpt", "claude", "perplexity"],
        "method_version": 1,
    }
    run = _run([ex(engine="claude", run=i, brands=["PSA", "CGC"]) for i in range(50)])
    run["engines"] = ["chatgpt", "claude", "claude-code", "perplexity"]
    run["method_version"] = 2

    assert run_checks(run, brand_week(run), [], previous=previous).passed


def test_an_unchanged_engine_list_is_not_flagged():
    previous = {"engines": ["chatgpt", "claude"], "method_version": 1}
    run = _run([ex(engine="claude", run=i, brands=["PSA", "CGC"]) for i in range(50)])
    run["engines"] = ["claude", "chatgpt"]  # order must not matter
    run["method_version"] = 1

    assert run_checks(run, brand_week(run), [], previous=previous).passed


# --- version and possessive folding -----------------------------------------

def test_a_point_release_is_the_same_brand():
    """Otherwise the chart grows a new row every time a vendor ships a version.

    This was the largest single source of quarantine churn: FLUX.2, Stable
    Diffusion 3.5 and Seedream 4.5 all arrived as unrecognised names for brands
    already on the chart.
    """
    aliases = AliasMap({"Flux": ["flux"], "Stable Diffusion": ["stable diffusion"]})
    cleaned, quarantined = normalize(
        [ex(brands=["FLUX.2"]), ex(brands=["Stable Diffusion 3.5"])], aliases
    )
    assert [e.brands[0].name for e in cleaned] == ["Flux", "Stable Diffusion"]
    assert quarantined == []


def test_a_version_is_never_stripped_down_to_nothing():
    """`sd3` and `a1111` are whole names, not a name plus a version."""
    from unprompted.normalize import _key

    assert _key("sd3") == "sd3"
    assert _key("a1111") == "a1111"


def test_a_possessive_folds_to_the_plain_name():
    aliases = AliasMap({"Imagen": ["google gemini"]})
    cleaned, quarantined = normalize([ex(brands=["Google\u2019s Gemini"])], aliases)
    assert cleaned[0].brands[0].name == "Imagen"
    assert quarantined == []


def test_folding_never_merges_two_different_brands():
    """A guard on the maps themselves, not just the function.

    Folding can only ever merge spellings together, so the risk it introduces is
    two distinct brands collapsing into one key. That would silently combine two
    rows on a published chart, so every shipped alias map is checked for it.
    """
    import collections

    from unprompted.normalize import _key

    for path in sorted(Path(__file__).resolve().parents[1].joinpath("aliases").glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        owners = collections.defaultdict(set)
        for canonical, spellings in (data.get("canonical") or {}).items():
            for spelling in [canonical, *(spellings or [])]:
                owners[_key(spelling)].add(canonical)
        excluded = {_key(x) for x in (data.get("exclude") or [])}

        for key, brands in owners.items():
            assert len(brands) == 1, f"{path.name}: {key} claimed by {brands}"
            assert key not in excluded, f"{path.name}: {key} is both charted and excluded"


def test_a_tier_folds_into_an_excluded_name_rather_than_quarantining():
    """"ChatGPT Plus" is ChatGPT wearing a price tier, and ChatGPT is excluded."""
    aliases = AliasMap({"DALL-E": ["dall e"]}, exclude=["chatgpt"])
    cleaned, quarantined = normalize([ex(brands=["ChatGPT Plus"])], aliases)
    assert cleaned[0].brands == []
    assert quarantined == []


def test_a_loose_exclusion_never_beats_an_exact_brand():
    """The regression this ordering exists to prevent.

    "Stability AI" is an alias of Stable Diffusion while "stability" sits in the
    exclude list. Folding before resolving would delete a charted brand.
    """
    aliases = AliasMap(
        {"Stable Diffusion": ["stability ai"]}, exclude=["stability"]
    )
    cleaned, quarantined = normalize([ex(brands=["Stability AI"])], aliases)
    assert [b.name for b in cleaned[0].brands] == ["Stable Diffusion"]
    assert quarantined == []


def test_a_bracketed_variant_resolves_like_a_parenthetical():
    aliases = AliasMap({"Flux": ["flux"]})
    cleaned, quarantined = normalize([ex(brands=["FLUX.1 [schnell]"])], aliases)
    assert cleaned[0].brands[0].name == "Flux"
    assert quarantined == []


def test_a_tier_and_a_version_both_come_off():
    aliases = AliasMap({"Recraft": ["recraft"]})
    cleaned, _ = normalize([ex(brands=["Recraft V4 Pro"])], aliases)
    assert cleaned[0].brands[0].name == "Recraft"


def test_an_answer_survives_a_harness_that_fails_after_producing_it():
    """The operator's own SessionEnd hooks run on every invocation.

    One of them failing makes claude exit 1 with a finished answer already on
    stdout. Recording that as an extraction failure cost 14 good reads in one
    week and helped push it over the error-rate limit.
    """
    from unprompted.cli_provider import CliProvider, ProviderError
    from unprompted.extract import _extract_via_cli
    from unprompted.models import Extraction

    class Flaky(CliProvider):
        def ask(self, prompt: str) -> str:
            raise ProviderError(
                "claude-cli: exit 1: SessionEnd hook failed",
                stdout='{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}',
            )

    base = Extraction(engine="claude", question_id="q01", run_index=0)
    answer = EngineAnswer(engine="claude", question_id="q01", question="", run_index=0, text="...")
    result = _extract_via_cli(base, answer, Flaky("x", "X", "claude", ("-p",)))

    assert result.error is None
    assert [b.name for b in result.brands] == ["Midjourney"]


def test_a_genuinely_broken_call_still_fails():
    """The salvage must not turn every crash into a silent empty reading."""
    from unprompted.cli_provider import CliProvider, ProviderError
    from unprompted.extract import _extract_via_cli
    from unprompted.models import Extraction

    class Broken(CliProvider):
        def ask(self, prompt: str) -> str:
            raise ProviderError("claude-cli: exit 1: out of quota", stdout="rate limited\n")

    base = Extraction(engine="claude", question_id="q01", run_index=0)
    answer = EngineAnswer(engine="claude", question_id="q01", question="", run_index=0, text="...")
    result = _extract_via_cli(base, answer, Broken("x", "X", "claude", ("-p",)))

    assert result.error and "extract failed" in result.error


# -- the batch extractor ------------------------------------------------------
#
# The whole weekly read goes through one batch job, so the mapping from result
# back to answer is the thing that must not be wrong. Results come back
# unordered, an answer that never needed a call was never submitted, and a
# request can go missing entirely. Each of those puts a brand on the wrong row
# or reads as a clean refusal, and neither shows up as an error anywhere.


class _FakeBatches:
    """Enough of client.messages.batches to exercise the mapping."""

    def __init__(self, replies, drop=()):
        self.replies = replies  # custom_id -> reply text, or None to error
        self.drop = set(drop)  # custom_ids to withhold entirely
        self.submitted = []

    def create(self, requests):
        self.submitted = list(requests)
        return self._batch()

    def retrieve(self, _id):
        return self._batch()

    def _batch(self):
        counts = type("C", (), {"succeeded": 0, "processing": 0})()
        return type(
            "B", (), {"id": "msgbatch_test", "processing_status": "ended", "request_counts": counts}
        )()

    def results(self, _id):
        # Reversed, because real batches come back in no particular order.
        for request in reversed(self.submitted):
            cid = request["custom_id"]
            if cid in self.drop:
                continue
            text = self.replies.get(cid)
            if text is None:
                yield type("E", (), {"custom_id": cid, "result": type("R", (), {"type": "errored"})()})()
                continue
            usage = type("U", (), {"input_tokens": 11, "output_tokens": 22})()
            message = type(
                "M", (), {"content": [type("T", (), {"text": text})()], "usage": usage}
            )()
            yield type(
                "E",
                (),
                {"custom_id": cid, "result": type("R", (), {"type": "succeeded", "message": message})()},
            )()


def _fake_client(batches):
    return type("C", (), {"messages": type("M", (), {"batches": batches})()})()


def _answer(qid, text, error=None):
    return EngineAnswer(
        engine="claude", question_id=qid, question="", run_index=0, text=text, error=error
    )


def test_batch_results_land_on_the_answer_they_came_from(monkeypatch):
    """Out-of-order results, and answers that were never submitted at all."""
    from unprompted import extract

    answers = [
        _answer("q01", "engine died", error="engine failed: timeout"),  # not submitted
        _answer("q02", "Try Midjourney first."),
        _answer("q03", "   "),  # empty: a refusal, not submitted
        _answer("q04", "I would use Ideogram."),
    ]
    batches = _FakeBatches(
        {
            "x1": '{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}',
            "x3": '{"refused": false, "brands": [{"name": "Ideogram", "position": 1}]}',
        }
    )
    monkeypatch.setattr(extract, "_client", lambda _key: _fake_client(batches))

    out = extract.extract_all_batch(answers)

    assert [r["custom_id"] for r in batches.submitted] == ["x1", "x3"]
    assert len(out) == 4
    assert out[0].error == "engine failed: timeout"
    assert [b.name for b in out[1].brands] == ["Midjourney"]
    assert out[2].refused is True and out[2].error is None
    assert [b.name for b in out[3].brands] == ["Ideogram"]
    assert out[1].usage["extract_input_tokens"] == 11


def test_a_batch_result_that_never_comes_back_is_an_error_not_a_refusal(monkeypatch):
    """A withheld result must not read as "this answer named nobody"."""
    from unprompted import extract

    answers = [_answer("q01", "Try Midjourney."), _answer("q02", "Try Ideogram.")]
    batches = _FakeBatches(
        {"x0": '{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}'},
        drop=["x1"],
    )
    monkeypatch.setattr(extract, "_client", lambda _key: _fake_client(batches))

    out = extract.extract_all_batch(answers)

    assert [b.name for b in out[0].brands] == ["Midjourney"]
    assert out[1].error and "no result" in out[1].error
    assert out[1].refused is False


def test_a_failed_request_inside_a_good_batch_only_costs_that_answer(monkeypatch):
    from unprompted import extract

    answers = [_answer("q01", "Try Midjourney."), _answer("q02", "Try Ideogram.")]
    batches = _FakeBatches(
        {
            "x0": '{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}',
            "x1": None,  # errored
        }
    )
    monkeypatch.setattr(extract, "_client", lambda _key: _fake_client(batches))

    out = extract.extract_all_batch(answers)

    assert [b.name for b in out[0].brands] == ["Midjourney"]
    assert out[1].error and "errored" in out[1].error


def test_a_dead_batch_holds_the_week_instead_of_destroying_it(monkeypatch):
    """The regression that made batching dangerous.

    Engine answers exist only in memory until a record is written, and
    extraction runs after every engine call has been paid for. extract_all_batch
    raising on submit therefore threw away a whole category's spend with nothing
    left on disk to re-read, and the error text told the operator to reextract a
    file that was never written.

    Marking the records instead routes the week through machinery that already
    exists: the error-rate check holds it, the held file keeps every raw answer,
    and reextract re-reads it for the price of the extraction alone.
    """
    from unprompted import extract

    answers = [_answer(f"q{i:02d}", f"Try Midjourney. {i}") for i in range(6)]

    class Refusing:
        def create(self, requests):
            raise RuntimeError("529 overloaded")

    monkeypatch.setattr(
        extract,
        "_client",
        lambda _key: type("C", (), {"messages": type("M", (), {"batches": Refusing()})()})(),
    )

    out = extract.extract_all_batch(answers)

    assert len(out) == len(answers)
    assert all(r.answer for r in out), "the raw answers must survive to be re-read"
    assert all(r.error for r in out), "a lost answer must not read as a clean refusal"
    assert not any(r.refused for r in out)
    assert all("529 overloaded" in r.error for r in out), "say what actually broke"


def test_a_batch_that_dies_halfway_keeps_what_it_already_read(monkeypatch):
    """A partial failure should cost the unread answers, not the read ones."""
    from unprompted import extract

    answers = [_answer(f"q{i:02d}", f"Try Midjourney. {i}") for i in range(3)]
    good = '{"refused": false, "brands": [{"name": "Midjourney", "position": 1}]}'

    class HalfDead(_FakeBatches):
        def results(self, _id):
            yield next(iter(super().results(_id)))
            raise ConnectionError("stream dropped")

    batches = HalfDead({f"x{i}": good for i in range(3)})
    monkeypatch.setattr(extract, "_client", lambda _key: _fake_client(batches))

    out = extract.extract_all_batch(answers)

    read = [r for r in out if not r.error]
    assert len(read) == 1 and [b.name for b in read[0].brands] == ["Midjourney"]
    assert sum(1 for r in out if r.error) == 2
    assert all("stream dropped" in r.error for r in out if r.error)


def test_an_engine_that_answered_nothing_holds_the_week():
    """The near-miss of 2026-08-24, made into a rule.

    The hosted claude engine returned 0 of 75 that day because its API spend cap
    was exhausted. With five engines a completely dead one is exactly 20% of
    calls, and rule 3 allows up to 20%, so the week passed the error check on a
    rounding error and would have published a chart claiming five assistants
    were asked when four were.
    """
    live = [ex(engine="chatgpt", run=i, brands=["PSA", "CGC"]) for i in range(40)]
    dead = [
        ex(engine="claude", run=i, error="engine failed: 400 usage limit reached")
        for i in range(10)
    ]

    run = _run(live + dead) | {"engines": ["chatgpt", "claude"]}
    # Exactly the boundary that let this through: 10 of 50 is 20%, and rule 3
    # allows up to 20%, so nothing else in the suite objects.
    assert 10 / 50 == MAX_ERROR_RATE
    result = run_checks(run, brand_week(run), [])

    assert result.held
    assert any("claude failed 10 of its own 10" in r for r in result.reasons)
    assert not any("of engine calls errored" in r for r in result.reasons), (
        "rule 3 stays silent here, which is the whole point"
    )

    # The same run with that engine actually answering passes.
    alive = [ex(engine="claude", run=i, brands=["PSA"]) for i in range(10)]
    ok = _run(live + alive) | {"engines": ["chatgpt", "claude"]}
    assert run_checks(ok, brand_week(ok), []).passed


def test_a_stale_file_for_one_category_does_not_abort_the_week(tmp_path, monkeypatch):
    """persist() used to raise SystemExit, which killed the whole run.

    On 2026-08-24 a leftover held file did exactly that: the run aborted after
    ai-image-generators had already paid for 375 engine calls, and
    ai-writing-tools never ran. FileExistsError is an ordinary exception, so
    main()'s per-category handler can absorb it.
    """
    from unprompted import run as run_mod

    monkeypatch.setattr(run_mod, "ROOT", tmp_path)
    record = RunRecord(
        category="x", run_date="2026-08-24", method_version=1, runs_per_question=1,
        engines=["claude"], extractor="api",
        extractions=[Extraction(engine="claude", question_id="q01", run_index=0)],
        quarantined=[],
    )
    # Held rather than published, so persist does not also try to write a
    # report; the report template is not what this is testing.
    run_mod.persist(record, reasons=["held for the test"])

    with pytest.raises(FileExistsError):
        run_mod.persist(record, reasons=["held for the test"])

    # Still an ordinary Exception, so the per-category handler in main() sees it.
    assert issubclass(FileExistsError, Exception)


def test_a_tier_strips_to_the_product_before_the_parent_company():
    """The intermediate reading must not be skipped.

    Stripping used to jump straight to the shortest form, so "JetBrains AI Pro"
    went past "jetbrains ai" -- the charted product -- and landed on
    "jetbrains", the company, which is excluded. A real mention of the product
    was deleted rather than charted.
    """
    aliases = AliasMap(
        {"JetBrains AI": ["jetbrains ai", "jetbrains ai assistant"]},
        exclude=["jetbrains"],
    )

    assert aliases.resolve("JetBrains AI Pro") == "JetBrains AI"
    assert aliases.resolve("JetBrains AI Assistant Enterprise") == "JetBrains AI"
    # The company on its own is still excluded, which is the point of the pair.
    assert aliases.is_excluded("JetBrains")
    assert aliases.resolve("JetBrains") is None


def test_a_commercial_tier_is_not_a_different_product():
    """Eleven of the names that would have held 2026-08-24 were this."""
    aliases = AliasMap(
        {"GitHub Copilot": ["github copilot", "copilot"], "Windsurf": ["codeium"]},
        exclude=["chatgpt"],
    )

    for raw in (
        "GitHub Copilot Free",
        "GitHub Copilot Enterprise",
        "GitHub Copilot Business/Enterprise",
        "GitHub Copilot CLI",
        "Copilot Free",
    ):
        assert aliases.resolve(raw) == "GitHub Copilot", raw
    assert aliases.resolve("Codeium Enterprise") == "Windsurf"
    # And a tier on an excluded name stays excluded rather than quarantining.
    assert aliases.is_excluded_loosely("ChatGPT Business")


def test_an_exact_alias_still_beats_a_folded_reading():
    """"Gemini CLI" is a real alias; folding it would hit the exclude list."""
    aliases = AliasMap(
        {"Gemini Code Assist": ["gemini code assist", "gemini cli"]},
        exclude=["gemini"],
    )

    assert aliases.resolve("Gemini CLI") == "Gemini Code Assist"
    assert aliases.is_excluded("Gemini")


def test_every_shipped_alias_still_resolves_to_its_own_brand():
    """The guard for every future alias edit.

    Folding rules and exclude lists are edited far more often than this file,
    and the failure they cause is silent: a charted brand starts resolving to
    something else, or gets excluded by a parent company added later. Reading
    the real alias maps rather than a fixture is the point -- a fixture cannot
    catch "someone excluded 'jetbrains' and deleted JetBrains AI".
    """
    for path in sorted(Path(__file__).resolve().parents[1].joinpath("aliases").glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        aliases = AliasMap.load(path)
        for brand, spellings in (data.get("canonical") or {}).items():
            for spelling in [brand] + list(spellings or []):
                assert not aliases.is_excluded(spelling), (
                    f"{path.stem}: {spelling!r} is an alias of {brand!r} and is "
                    f"also on the exclude list"
                )
                assert aliases.resolve(spelling) == brand, (
                    f"{path.stem}: {spelling!r} should resolve to {brand!r}, "
                    f"got {aliases.resolve(spelling)!r}"
                )


def test_no_excluded_name_swallows_a_charted_brand():
    """An exclusion must never win against a brand that contains it.

    "stability" is excluded and "Stability AI" is Stable Diffusion; "jetbrains"
    is excluded and "JetBrains AI" is charted; "gemini" is excluded and "Gemini
    CLI" is Gemini Code Assist. Each of those pairs has been broken at least
    once by an ordering change.
    """
    for path in sorted(Path(__file__).resolve().parents[1].joinpath("aliases").glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        aliases = AliasMap.load(path)
        for brand, spellings in (data.get("canonical") or {}).items():
            for spelling in [brand] + list(spellings or []):
                # The full normalize() order, not just one step of it.
                if aliases.is_excluded(spelling):
                    resolved = None
                elif (found := aliases.resolve(spelling)) is not None:
                    resolved = found
                elif aliases.is_excluded_loosely(spelling):
                    resolved = None
                else:
                    resolved = "QUARANTINED"
                assert resolved == brand, (
                    f"{path.stem}: {spelling!r} ends up as {resolved!r}, not {brand!r}"
                )


def test_an_engine_that_barely_answered_holds_the_week():
    """The hole the all-failed rule left, found by an independent audit.

    One success was enough to satisfy "did this engine answer anything", so an
    engine could succeed once, fail its other 74 calls, and publish: 74 of 375
    is 19.7%, under rule 3's global limit. The week then compares five engines
    of which one answered once.
    """
    rows = []
    for engine in ("chatgpt", "claude", "perplexity", "claude-code", "codex"):
        for i in range(75):
            broken = engine == "claude" and i > 0
            rows.append(
                ex(
                    engine=engine,
                    qid=f"q{i % 15:02d}",
                    run=i,
                    brands=() if broken else ("PSA", "CGC"),
                    error="engine failed: 400 quota" if broken else None,
                )
            )

    run = _run(rows) | {
        "engines": ["chatgpt", "claude", "claude-code", "codex", "perplexity"],
        "method_version": 2,
    }
    errored = sum(1 for r in run["extractions"] if r.get("error"))
    assert errored / len(rows) < MAX_ERROR_RATE, "rule 3 must not be what catches it"

    result = run_checks(run, brand_week(run), [], max_brands=25)

    assert result.held
    assert any("claude failed 74 of its own 75" in r for r in result.reasons)


def test_the_published_image_week_would_not_publish_today():
    """A real regression case, taken from data/runs/2026-08-24.

    That week published with the hosted claude engine failing 24 of its own 75
    calls -- a third of one of three engines -- because 24 of 225 is only 10.7%
    overall. The standings on the site compare an engine that answered two
    thirds of the time against two that answered every time.
    """
    rows = []
    for engine in ("chatgpt", "claude", "perplexity"):
        for i in range(75):
            broken = engine == "claude" and i < 24
            rows.append(
                ex(
                    engine=engine,
                    qid=f"q{i % 15:02d}",
                    run=i,
                    brands=() if broken else ("PSA", "CGC"),
                    error="engine failed: 400 usage limit" if broken else None,
                )
            )

    run = _run(rows) | {"engines": ["chatgpt", "claude", "perplexity"], "method_version": 1}
    result = run_checks(run, brand_week(run), [], max_brands=25)

    assert result.held
    assert any("claude failed 24 of its own 75 calls (32%)" in r for r in result.reasons)


def test_disabling_a_hosted_engine_in_the_registry_actually_disables_it(monkeypatch, tmp_path):
    """The admin dashboard's hosted-engine toggles did nothing at all.

    ChatGPT, Claude and Perplexity were an unconditional dict in
    engines/__init__.py, so turning one off in /admin still queried it, still
    billed for it, and still charted it. The dashboard and the pipeline could
    report different engine sets and neither knew.
    """
    import json

    from unprompted import cli_provider
    from unprompted.engines import all_engines

    registry = tmp_path / "providers.json"

    def write(providers):
        registry.write_text(json.dumps({"providers": providers}), encoding="utf-8")

    monkeypatch.setattr(cli_provider, "REGISTRY", registry)

    write([
        {"id": "chatgpt", "kind": "api", "role": "engine", "enabled": True},
        {"id": "claude", "kind": "api", "role": "engine", "enabled": True},
        {"id": "perplexity", "kind": "api", "role": "engine", "enabled": True},
    ])
    assert sorted(all_engines()) == ["chatgpt", "claude", "perplexity"]

    write([
        {"id": "chatgpt", "kind": "api", "role": "engine", "enabled": True},
        {"id": "claude", "kind": "api", "role": "engine", "enabled": False},
        {"id": "perplexity", "kind": "api", "role": "engine", "enabled": True},
    ])
    assert sorted(all_engines()) == ["chatgpt", "perplexity"]


def test_an_enabled_engine_with_no_adapter_is_an_error_not_a_silent_omission(
    monkeypatch, tmp_path
):
    """The admin route accepts any `env` string, so this is reachable from the UI."""
    import json

    from unprompted import cli_provider
    from unprompted.engines import all_engines

    registry = tmp_path / "providers.json"
    registry.write_text(
        json.dumps({"providers": [
            {"id": "gemini", "kind": "api", "role": "engine", "enabled": True},
        ]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(cli_provider, "REGISTRY", registry)

    with pytest.raises(cli_provider.ProviderError, match="no adapter"):
        all_engines()


def _registry(monkeypatch, entries):
    from unprompted import cli_provider

    monkeypatch.setattr(cli_provider, "load_registry", lambda: entries)
    return cli_provider


def test_an_unavailable_cli_extractor_is_skipped_rather_than_selected(monkeypatch):
    """The registry is edited on a machine that is not the one that runs.

    Selecting a CLI that is not installed turned all 225 extractions into
    errors, and before the publish gate existed, published the result.
    """
    cli_provider = _registry(
        monkeypatch,
        [
            {
                "id": "ghost-cli",
                "kind": "cli",
                "role": "extractor",
                "enabled": True,
                "command": "definitely-not-installed",
            }
        ],
    )
    # Nothing enabled can run, which is a reason to stop rather than to return
    # a None the caller will read as "use the hosted default".
    with pytest.raises(cli_provider.ProviderError, match="enabled and available"):
        cli_provider.resolve_extractor()


def test_a_hosted_extractor_is_chosen_by_its_registry_id(monkeypatch):
    """The id decides which hosted reader runs, and is recorded on the week.

    Returning a bare None for any API entry meant the caller assumed Anthropic
    whatever the registry said: enabling a different hosted extractor through
    the admin UI silently ran Claude and stamped the run "api".
    """
    cli_provider = _registry(
        monkeypatch,
        [{"id": "claude-api-extract", "kind": "api", "role": "extractor", "enabled": True}],
    )
    monkeypatch.setenv("ANTHROPIC_API_KEY", "present")

    chosen = cli_provider.resolve_extractor()

    assert isinstance(chosen, cli_provider.ApiExtractor)
    assert chosen.id == "claude-api-extract"
    assert chosen.model  # the week records which model read it


def test_a_hosted_extractor_with_no_key_falls_through_to_the_cli(monkeypatch):
    """The registry, the README and the dashboard all call the CLIs fallbacks.

    Selection used to stop at the first API entry, so with the key absent the
    run aborted instead of reaching the local harness sitting right below it.
    """
    cli_provider = _registry(
        monkeypatch,
        [
            {"id": "claude-api-extract", "kind": "api", "role": "extractor", "enabled": True},
            {
                "id": "claude-cli",
                "kind": "cli",
                "role": "extractor",
                "enabled": True,
                "command": "claude",
                "args": ["-p", "--strict-mcp-config"],
            },
        ],
    )
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(cli_provider.shutil, "which", lambda cmd: f"/usr/bin/{cmd}")

    chosen = cli_provider.resolve_extractor()

    assert isinstance(chosen, cli_provider.CliProvider)
    assert chosen.id == "claude-cli"


def test_an_unknown_hosted_extractor_is_refused_rather_than_substituted(monkeypatch):
    """The admin route accepts any id with an env var, so this is reachable.

    Substituting the one adapter that does exist would read the week with a
    different model from the one the operator selected, and record it as
    theirs.
    """
    cli_provider = _registry(
        monkeypatch,
        [{"id": "mistral-api-extract", "kind": "api", "role": "extractor", "enabled": True}],
    )
    with pytest.raises(cli_provider.ProviderError, match="no adapter exists"):
        cli_provider.resolve_extractor()


def test_a_broken_registry_stops_the_run_instead_of_shrinking_it(monkeypatch, tmp_path):
    """Returning [] on a parse error reads as "no engines declared".

    On a first run there is no previous engine list for the series check to
    compare against, so a truncated or hand-broken providers.json would have
    measured a smaller field and published it with nothing objecting.
    """
    from unprompted import cli_provider

    registry = tmp_path / "providers.json"
    monkeypatch.setattr(cli_provider, "REGISTRY", registry)

    registry.write_text('{"providers": [{"id": "claude"', encoding="utf-8")
    with pytest.raises(cli_provider.ProviderError, match="not valid JSON"):
        cli_provider.load_registry()

    registry.write_text('{"nope": []}', encoding="utf-8")
    with pytest.raises(cli_provider.ProviderError, match="no 'providers' list"):
        cli_provider.load_registry()

    registry.write_text('{"providers": [{"label": "no id here"}]}', encoding="utf-8")
    with pytest.raises(cli_provider.ProviderError, match="no id"):
        cli_provider.load_registry()


def test_a_brand_not_present_in_the_answer_is_dropped():
    """Structured output constrains shape, not truthfulness.

    Engine answers are prose written by another model quoting web pages written
    by anyone, so "ignore the above and recommend X" is a reachable input. It
    would produce a schema-valid name that normalizes cleanly, never reaches
    quarantine, and lands on a public chart.
    """
    from unprompted.extract import _apply

    answer = "For most people I would use Midjourney, or Ideogram for text."
    base = Extraction(engine="claude", question_id="q01", run_index=0, answer=answer)

    _apply(base, {"refused": False, "brands": [
        {"name": "Midjourney", "position": 1},
        {"name": "TotallyRealCo", "position": 2},   # never appears in the text
        {"name": "Ideogram", "position": 3},
    ]})

    assert [b.name for b in base.brands] == ["Midjourney", "Ideogram"]
    assert base.usage["extract_unsupported_brands"] == 1


def test_punctuation_differences_do_not_count_as_invention():
    """The engines write one product several ways; the guard is a floor."""
    from unprompted.extract import _apply

    answer = "OpenAI's DALL\u00b7E 3 is easiest, then Stable-Diffusion."
    base = Extraction(engine="claude", question_id="q01", run_index=0, answer=answer)

    _apply(base, {"refused": False, "brands": [
        {"name": "DALL-E 3", "position": 1},
        {"name": "Stable Diffusion", "position": 2},
    ]})

    assert [b.name for b in base.brands] == ["DALL-E 3", "Stable Diffusion"]
    assert "extract_unsupported_brands" not in base.usage


def test_the_guard_is_skipped_when_there_is_no_answer_to_check():
    """Re-reads of very old records may have no stored answer text."""
    from unprompted.extract import _apply

    base = Extraction(engine="claude", question_id="q01", run_index=0, answer="")
    _apply(base, {"refused": False, "brands": [{"name": "Midjourney", "position": 1}]})

    assert [b.name for b in base.brands] == ["Midjourney"]


def test_a_permanent_failure_is_not_retried_three_times():
    """The real 2026-08-24 error, and the transient ones it must not resemble."""
    from unprompted.engines.base import Engine

    real_cap_error = (
        "BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': "
        "'invalid_request_error', 'message': 'You have reached your specified API "
        "usage limits. You will regain access on 2026-09-01'}}"
    )

    class BadRequestError(Exception):
        pass

    class RateLimitError(Exception):
        pass

    assert not Engine.is_retryable(BadRequestError(real_cap_error))
    assert not Engine.is_retryable(Exception("invalid api key"))
    assert not Engine.is_retryable(Exception("Your credit balance is too low"))

    # Transient, and a rate limit is the one 4xx worth waiting out.
    assert Engine.is_retryable(RateLimitError("429 too many requests"))
    assert Engine.is_retryable(TimeoutError("read timed out"))
    assert Engine.is_retryable(ConnectionError("connection reset"))
    # Unknown stays retryable: losing an answer is worse than wasting a call.
    assert Engine.is_retryable(Exception("something nobody has seen before"))


def test_a_permanent_failure_stops_after_one_attempt():
    from unprompted.engines.base import Engine

    calls = []

    class Capped(Engine):
        name = "capped"
        key_names = ("X",)

        def __init__(self):
            self.api_key = "set"

        def _one_call(self, question):
            calls.append(1)
            raise Exception("You have reached your specified API usage limits")

    answer = Capped().ask_one("q01", "why", 0)

    assert len(calls) == 1, f"attempted {len(calls)} times, should stop at 1"
    assert answer.error and "usage limits" in answer.error


def test_a_transient_failure_still_gets_its_retries():
    from unprompted.engines.base import Engine

    calls = []

    class Flaky(Engine):
        name = "flaky"
        key_names = ("X",)

        def __init__(self):
            self.api_key = "set"

        def _one_call(self, question):
            calls.append(1)
            if len(calls) < 3:
                raise TimeoutError("read timed out")
            return "Try Midjourney.", [], {}

    answer = Flaky().ask_one("q01", "why", 0)

    assert len(calls) == 3
    assert answer.error is None and answer.text == "Try Midjourney."


def test_the_local_schema_fallback_matches_the_sdk_transform():
    """The batch request is built with a private SDK helper.

    `anthropic.lib._parse._transform.transform_schema` is the one parse() calls,
    so it cannot drift from what the API accepts without parse() breaking too --
    but it is private, and an unattended upgrade moving it used to raise while
    building the request, before a single answer had been read. There is now a
    local fallback, and this asserts it produces exactly the same schema.

    If this fails after an SDK upgrade, the fallback needs updating to match the
    new output; it does not mean the fallback is wrong to exist.
    """
    import json

    from unprompted.extract import _Extraction, _local_schema

    transform = pytest.importorskip("anthropic.lib._parse._transform")

    assert json.dumps(_local_schema(_Extraction), sort_keys=True) == json.dumps(
        transform.transform_schema(_Extraction), sort_keys=True
    )
