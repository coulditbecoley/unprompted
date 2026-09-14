"""Prepare a blinded, reproducible review sample and score supplied labels offline.

This evaluates saved normalized readings, including extraction AND alias decisions.
It makes no model calls and never writes into the measurement archive.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def prepare(root: Path, paths: list[str], per_stratum: int, seed: str) -> tuple[dict, dict]:
    if type(per_stratum) is not int or not 1 <= per_stratum <= 100:
        raise ValueError("per-stratum must be an integer from 1 to 100")
    root = root.resolve()
    sources, excluded, groups, predictions = [], Counter(), defaultdict(list), {}
    seen_paths = set()
    for name in sorted(paths):
        path = (root / name).resolve()
        if not any(path.is_relative_to((root / area).resolve()) for area in ("data/runs", "data/held")):
            raise ValueError("sources must be inside data/runs or data/held")
        relative = path.relative_to(root).as_posix()
        if relative in seen_paths:
            raise ValueError("duplicate source")
        seen_paths.add(relative)
        raw = path.read_bytes()
        run = json.loads(raw)
        if path.stem != run["category"] or path.parent.name != run["run_date"]:
            raise ValueError("source identity differs from its path")
        sources.append({"path": relative, "sha256": digest(raw)})
        questions = {q["id"]: q["text"] for q in run.get("methodology", {}).get("questions", {}).get("questions", [])}
        seen_rows = set()
        for row in run["extractions"]:
            identity = (row["engine"], row["question_id"], row["run_index"])
            if identity in seen_rows:
                raise ValueError("duplicate answer identity")
            seen_rows.add(identity)
            group = f"{run['category']}/{row['engine']}"
            groups[group]  # retain engines with no reviewable answers
            if row.get("error") or not row.get("answer", "").strip():
                excluded[group] += 1
                continue
            names = [b["name"] for b in sorted(row["brands"], key=lambda b: b["position"])]
            if (type(row["refused"]) is not bool
                or any(not isinstance(n, str) or not n.strip() for n in names)
                or len(set(names)) != len(names)):
                raise ValueError("invalid saved brand names")
            item_id = digest(json.dumps([relative, *identity], ensure_ascii=False).encode())
            predictions[item_id] = {"brands": names, "refused": row["refused"]}
            groups[group].append({
                "id": item_id, "source": relative, "category": run["category"],
                "engine": row["engine"], "question_id": row["question_id"],
                "run_index": row["run_index"], "question": questions.get(row["question_id"]),
                "answer": row["answer"], "sources": row.get("sources", []), "review": None,
            })
    strata, items = [], []
    for group, rows in sorted(groups.items()):
        chosen = sorted(rows, key=lambda item: digest((seed + ":" + item["id"]).encode()))[:per_stratum]
        items.extend(chosen)
        strata.append({"stratum": group, "eligible": len(rows), "sampled": len(chosen),
                       "excluded_error_or_empty": excluded[group]})
    if not sources or not items:
        raise ValueError("no reviewable answers in the selected sources")
    return {"schema": 1, "seed": seed, "per_stratum": per_stratum,
            "sources": sources, "strata": strata, "items": items}, predictions


def score(root: Path, packet: dict) -> dict:
    # Regenerate all evidence and the deterministic sample. A changed answer,
    # source, prediction, sample membership or duplicate row cannot silently score.
    expected, predictions = prepare(root, [s["path"] for s in packet["sources"]], packet["per_stratum"], packet["seed"])
    evidence = dict(packet)
    evidence["items"] = [dict(item, review=None) for item in packet["items"]]
    if evidence != expected:
        raise ValueError("review evidence differs from the source-bound sample")
    counts = Counter()
    disagreements, reviewers = [], set()
    for item in packet["items"]:
        review = item["review"]
        if review is None:
            continue
        if not isinstance(review, dict) or set(review) != {"reviewer", "brands", "refused", "notes"}:
            raise ValueError("review requires reviewer, brands, refused and notes")
        names = review["brands"]
        if (not isinstance(review["reviewer"], str) or not review["reviewer"].strip()
            or not isinstance(review["notes"], str) or type(review["refused"]) is not bool
            or not isinstance(names, list) or any(not isinstance(n, str) or not n.strip() or n != n.strip() for n in names)
            or len(set(names)) != len(names) or (review["refused"] and names)):
            raise ValueError("invalid review labels")
        reviewers.add(review["reviewer"].strip())
        predicted = predictions[item["id"]]
        actual, gold = set(predicted["brands"]), set(names)
        counts.update(reviewed=1, true_positive=len(actual & gold),
                      unsupported=len(actual - gold), missed=len(gold - actual),
                      exact_set=int(actual == gold),
                      first_match=int(predicted["brands"][:1] == names[:1]),
                      refusal_match=int(predicted["refused"] == review["refused"]))
        if actual != gold or predicted["brands"][:1] != names[:1] or predicted["refused"] != review["refused"]:
            disagreements.append({"id": item["id"], "source": item["source"],
                                  "predicted": predicted, "review": review})
    complete = counts["reviewed"] == len(packet["items"])
    metrics = None
    if complete:
        tp, fp, fn = counts["true_positive"], counts["unsupported"], counts["missed"]
        metrics = {"precision": tp / (tp + fp) if tp + fp else None,
                   "recall": tp / (tp + fn) if tp + fn else None,
                   "exact_set_accuracy": counts["exact_set"] / counts["reviewed"],
                   "first_brand_accuracy": counts["first_match"] / counts["reviewed"],
                   "refusal_accuracy": counts["refusal_match"] / counts["reviewed"]}
    return {"status": "complete" if complete else "awaiting_review",
            "scope": "Unweighted sampled answers only; supplied reviewer labels, not independently verified human judgments. Includes normalization effects; not an extractor-only or whole-archive accuracy estimate.",
            "reviewed": counts["reviewed"], "sampled": len(packet["items"]),
            "reviewers": sorted(reviewers), "strata": packet["strata"],
            "mention_counts": {k: counts[k] for k in ("true_positive", "unsupported", "missed")} if complete else None,
            "metrics": metrics, "disagreements": disagreements}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    commands = parser.add_subparsers(dest="command", required=True)
    sampling = commands.add_parser("prepare")
    sampling.add_argument("sources", nargs="+")
    sampling.add_argument("--per-stratum", type=int, default=5)
    sampling.add_argument("--seed", default="unprompted-review-v1")
    sampling.add_argument("--out", type=Path, required=True)
    scoring = commands.add_parser("score")
    scoring.add_argument("packet", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        packet, _ = prepare(args.root, args.sources, args.per_stratum, args.seed)
        out = args.out.resolve()
        if out.is_relative_to((args.root / "data").resolve()):
            raise ValueError("review output must be outside the data archive")
        with out.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(packet, ensure_ascii=False, indent=2) + "\n")
        print(f"Prepared {len(packet['items'])} answers; all labels are pending.")
    else:
        print(json.dumps(score(args.root, json.loads(args.packet.read_text(encoding="utf-8"))), indent=2))


if __name__ == "__main__":
    main()
