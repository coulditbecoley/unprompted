"""Offline audit probes. No provider calls, credentials, or production writes.

Run: python audit/2026-09-14/reproduce.py
These assert the observed defects, not desired future behavior.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from unprompted import budget, reextract, run
from unprompted.aggregate import brand_week
from unprompted.checks import run_checks
from unprompted.cli_provider import ApiExtractor
from unprompted.cost import cost_of_run
from unprompted.engines.base import Engine
from unprompted.extract import _apply, _base_for
from unprompted.models import EngineAnswer, Extraction, RunRecord

spec = importlib.util.spec_from_file_location("audit_sync", ROOT / "scripts/sync_analytics.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
findings = {}

with tempfile.TemporaryDirectory(prefix="unprompted-audit-") as scratch:
    tmp = Path(scratch)
    # A held source does not imply that its publication destination is absent.
    record = RunRecord("example", "2026-09-01", 1, 1, ["test"])
    published = tmp / "data/runs/2026-09-01/example.json"
    published.parent.mkdir(parents=True)
    published.write_text('{"original":true}', encoding="utf-8")
    with patch.object(run, "ROOT", tmp), patch.object(run, "write_report", return_value=tmp / "report.md"):
        run.persist(record, [], overwrite=True)
    assert "original" not in json.loads(published.read_text())
    findings["published_destination_overwrite"] = True

    # New-format raw analytics places _agents first through sort_keys=True.
    audience = tmp / "audience"
    sync.write_raw(audience, "2026-09-01", {"t:human": 7, "v:/": 7}, {})
    sync.write_index(audience, {})
    index = (audience / "Audience Index.md").read_text(encoding="utf-8")
    assert "0 agent hits" in index and "0 human views" in index
    findings["analytics_index_drops_snapshot_days"] = {"expected_humans": 7, "reported_humans": 0}

    # An increased aggregate does not guarantee every archived field increased.
    sync.write_raw(audience, "2026-09-02", {"t:human": 7, "v:/": 7}, {})
    sync.write_raw(audience, "2026-09-02", {"t:human": 9, "v:/else": 9}, {})
    replaced = json.loads((audience / "data/2026-09-02.json").read_text())
    assert "v:/" not in replaced
    findings["analytics_monotonic_sum_loses_fields"] = True

    # Exercise the actual reextract entry point with all external work mocked.
    source = tmp / "data/held/2026-09-03/example.json"
    source.parent.mkdir(parents=True)
    ex = Extraction("test", "q1", 0, answer="Alpha Beta", fetched_at="2026-09-03T12:00:00Z")
    original = RunRecord("example", "2026-09-03", 1, 1, ["test"], extractions=[ex])
    source.write_text(json.dumps(original.to_dict()), encoding="utf-8")
    (tmp / "questions").mkdir()
    (tmp / "questions/example.yml").write_text("max_brands: 15\n", encoding="utf-8")
    captured = []

    def fake_extract(answers, *args, **kwargs):
        captured.extend(answers)
        return [_base_for(a)[0] for a in answers]

    with patch.object(reextract, "ROOT", tmp), patch.object(reextract, "load_local_env"), \
         patch.object(reextract, "resolve_extractor", return_value=ApiExtractor("test", "test", "test", "unused")), \
         patch.object(reextract, "extract_run", side_effect=fake_extract), \
         patch.object(reextract.AliasMap, "load"), \
         patch.object(reextract, "normalize", side_effect=lambda rows, aliases: (rows, [])), \
         patch.object(reextract, "load_history", return_value=[]), \
         patch.object(reextract, "all_engines", return_value={}), \
         patch.object(reextract, "persist"), patch.object(reextract, "git_sha", return_value="audit"), \
         patch.object(sys, "argv", ["reextract", "2026-09-03", "--category", "example"]):
        reextract.main()
    assert captured[0].fetched_at == ""
    findings["reextract_loses_fetched_at"] = True

# Use a valid real record so the missing engine is the only change.
baseline = json.loads((ROOT / "data/runs/2026-08-22/ai-coding-assistants.json").read_text())
phantom = copy.deepcopy(baseline)
phantom["engines"].append("missing-engine")
verdict = run_checks(phantom, brand_week(phantom), [], max_brands=50)
assert verdict.passed
findings["declared_engine_without_rows_passes"] = True

changed = copy.deepcopy(baseline)
changed["runs_per_question"] = 100
verdict = run_checks(changed, brand_week(changed), brand_week(baseline), max_brands=50, previous=baseline)
assert verdict.passed
findings["repeat_count_change_without_version_passes"] = True

malformed = _apply(Extraction("test", "q", 0, answer="Alpha Beta"), {})
assert malformed.error is None and not malformed.refused and malformed.brands == []
findings["empty_extractor_object_counted_as_answer"] = True

class RateLimitError(Exception):
    pass
assert Engine.is_retryable(RateLimitError("429 insufficient_quota billing limit"))
findings["permanent_quota_429_retried"] = True

priced_failure = {
    "category": "example", "run_date": "2026-09-01", "extractor": "claude-api-extract",
    "extractions": [{"engine": "claude", "error": "extract failed", "usage": {"input_tokens": 10000}}],
}
estimate = budget.estimate_category("example", 375, [priced_failure])
assert estimate.dollars == 0 and estimate.confident
findings["paid_all_failed_run_predicts_zero"] = {"estimated": estimate.dollars, "confident": estimate.confident}

inventories = {}
for area in ("runs", "held"):
    records = []
    for path in sorted((ROOT / "data" / area).glob("*/*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("extractions", [])
        records.append({
            "file": path.relative_to(ROOT).as_posix(), "rows": len(rows),
            "errors": sum(bool(e.get("error")) for e in rows),
            "usd_at_repository_rates": cost_of_run(data)[1],
            "extract_input_tokens": sum((e.get("usage") or {}).get("extract_input_tokens", 0) for e in rows),
            "extract_output_tokens": sum((e.get("usage") or {}).get("extract_output_tokens", 0) for e in rows),
            "missing_fetch_timestamps": sum(not e.get("fetched_at") for e in rows),
        })
    inventories[area] = records

def luminance(color):
    values = [int(color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values]
    return sum(a * b for a, b in zip(linear, (0.2126, 0.7152, 0.0722)))

def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return round((hi + 0.05) / (lo + 0.05), 2)

evidence = {"observed_defects": findings, "archive": inventories,
            "metadata_contrast": {"dark": contrast("6a6f77", "08090a"), "light": contrast("8a8a8a", "ffffff")}}
output = Path(__file__).with_name("evidence.json")
output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print(f"{len(findings)} observed defects reproduced; evidence: {output}")
