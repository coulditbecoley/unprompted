"""Source-bound, offline acceptance for the manual reading review workflow."""
from copy import deepcopy
import json

import pytest

from scripts.review_extractions import prepare, score


def test_review_requires_complete_labels_and_unchanged_evidence(tmp_path):
    source = tmp_path / "data/runs/2026-09-14/alpha.json"
    source.parent.mkdir(parents=True)
    row = {"engine": "one", "question_id": "q1", "run_index": 0,
           "answer": "Use Alpha or Beta.", "refused": False,
           "brands": [{"name": "Alpha", "position": 1}, {"name": "Wrong", "position": 2}]}
    run = {"category": "alpha", "run_date": "2026-09-14", "extractions": [
        row, dict(row, engine="two"), dict(row, engine="failed", error="engine failed"),
    ]}
    source.write_text(json.dumps(run))
    paths = [source.relative_to(tmp_path).as_posix()]
    packet, _ = prepare(tmp_path, paths, 1, "fixed")
    assert packet == prepare(tmp_path, paths, 1, "fixed")[0]
    assert "Wrong" not in json.dumps(packet)  # predictions are blinded
    assert packet["strata"][0] == {"stratum": "alpha/failed", "eligible": 0,
                                   "sampled": 0, "excluded_error_or_empty": 1}
    assert score(tmp_path, packet)["metrics"] is None
    label = {"reviewer": "fixture reviewer", "brands": ["Alpha", "Beta"], "refused": False, "notes": "synthetic test"}
    packet["items"][0]["review"] = label
    assert score(tmp_path, packet)["status"] == "awaiting_review"
    assert score(tmp_path, packet)["metrics"] is None
    packet["items"][1]["review"] = label
    result = score(tmp_path, packet)
    assert result["status"] == "complete"
    assert result["metrics"] == {"precision": .5, "recall": .5,
        "exact_set_accuracy": 0, "first_brand_accuracy": 1, "refusal_accuracy": 1}
    assert result["mention_counts"] == {"true_positive": 2, "unsupported": 2, "missed": 2}
    assert len(result["disagreements"]) == 2
    for edit in ("answer", "duplicate", "reviewer", "refused", "duplicate_brand"):
        bad = deepcopy(packet)
        if edit == "answer": bad["items"][0]["answer"] = "Changed evidence"
        if edit == "duplicate": bad["items"].append(bad["items"][0])
        if edit == "reviewer": bad["items"][0]["review"]["reviewer"] = ""
        if edit == "refused": bad["items"][0]["review"]["refused"] = True
        if edit == "duplicate_brand": bad["items"][0]["review"]["brands"] = ["Alpha", "Alpha"]
        with pytest.raises(ValueError): score(tmp_path, bad)
    with pytest.raises(ValueError): prepare(tmp_path, paths * 2, 1, "fixed")
    with pytest.raises(ValueError): prepare(tmp_path, ["../outside.json"], 1, "fixed")
    source.write_text(json.dumps(run) + "\n")
    with pytest.raises(ValueError, match="evidence differs"): score(tmp_path, packet)


def test_no_predictions_has_undefined_precision_not_perfect_accuracy(tmp_path):
    source = tmp_path / "data/held/2026-09-14/alpha.json"
    source.parent.mkdir(parents=True)
    source.write_text(json.dumps({"category": "alpha", "run_date": "2026-09-14", "extractions": [
        {"engine": "one", "question_id": "q1", "run_index": 0, "answer": "No recommendation.",
         "brands": [], "refused": True}]}))
    packet, _ = prepare(tmp_path, [source.relative_to(tmp_path).as_posix()], 1, "fixed")
    packet["items"][0]["review"] = {"reviewer": "fixture reviewer", "brands": [], "refused": True, "notes": "synthetic"}
    metrics = score(tmp_path, packet)["metrics"]
    assert metrics["precision"] is None and metrics["recall"] is None
    assert metrics["refusal_accuracy"] == 1
