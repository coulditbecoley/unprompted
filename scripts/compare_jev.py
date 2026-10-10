"""Compare Jev's shadow readings with the published Opus readings.

Every number here is agreement with Opus, not accuracy. Neither reader is
ground truth; READING-REVIEW.md describes the human labels that would be.

Re-reading stored answers queries no engine. Without --read it makes no calls
at all and compares only the shadow readings already on disk; candidate
coverage needs no calls either.

  python scripts/compare_jev.py coverage
  python scripts/compare_jev.py compare [--read] [--out audit/<today>/jev-shadow-comparison.json]
  python scripts/compare_jev.py alarm 2026-10-12 --category ai-coding-assistants
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from unprompted.aggregate import _answered, brand_week, exceeds_noise  # noqa: E402
from unprompted.jev_reader import (PRICE_PER_MTOK, Finder, alias_policy, reading_set,  # noqa: E402
                                   shadow_path, write_shadow)
from unprompted.models import BrandMention, Extraction  # noqa: E402
from unprompted.normalize import AliasMap, _key, normalize  # noqa: E402

OPUS_DOLLARS_PER_1K = 14.10  # extract.py's measured figure for Opus extraction
LABEL = "Agreement with the published Opus reading, not accuracy. Neither reader is ground truth."


def sources(root: Path | None = None) -> list[Path]:
    root = root or ROOT
    return sorted((root / "data").glob("runs/*/*.json")) + sorted((root / "data").glob("held/*/*.json"))


def _identity(row: dict) -> tuple:
    return row["engine"], row["question_id"], row["run_index"]


def coverage(record: dict) -> dict:
    """How many brands in the Opus reading the code-only candidate step found.

    Opus brands are stored after normalize(), so they are canonical names; a
    candidate covers one when it resolves to the same canonical. Quarantined
    Opus names have no answer identity in the record, so they are matched
    against every candidate in the record by folded key.
    """
    finder = Finder(alias_policy(record)[0])
    found = total = answers = candidates = 0
    missed: Counter = Counter()
    keys: set[str] = set()
    for row in record["extractions"]:
        if row.get("error") or not row.get("answer", "").strip():
            continue
        found_here = finder.find(row["answer"])
        answers += 1
        candidates += len(found_here)
        keys |= {_key(c.name) for c in found_here}
        canon = {c.canonical for c in found_here if c.canonical}
        for brand in row.get("brands", []):
            total += 1
            if brand["name"] in canon:
                found += 1
            else:
                missed[brand["name"]] += 1
    quarantined = {_key(n) for n in record.get("quarantined", []) if _key(n)}
    exact = sum(1 for q in quarantined if q in keys)
    loose = sum(1 for q in quarantined if q in keys or any(q in k or (k and k in q) for k in keys))
    return {"answers": answers, "candidates_per_answer": round(candidates / answers, 1) if answers else None,
            "opus_brands": total, "opus_brands_found": found,
            "brand_coverage": round(found / total, 4) if total else None,
            "missed": dict(missed.most_common(10)),
            "quarantined_names": len(quarantined), "quarantined_found_exact": exact,
            "quarantined_found_overlapping": loose}


def _renormalize(rows: list[dict], aliases: AliasMap) -> list[dict]:
    """The Opus brand lists, through the same normalize() the Jev reading used."""
    extractions = [Extraction(engine=r["engine"], question_id=r["question_id"], run_index=r["run_index"],
                              brands=[BrandMention(b["name"], b["position"], b.get("sentiment", "neutral"))
                                      for b in r.get("brands", [])],
                              refused=r.get("refused", False), error=r.get("error"), answer=r.get("answer", ""))
                   for r in deepcopy(rows)]
    return [e.to_dict() for e in normalize(extractions, aliases)[0]]


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def _rotation(record: dict, reading: dict) -> list[dict] | str:
    """Each brand's Rotation under both readings, over each reading's usable answers.

    A reading with usable answers and no surviving brands is a real 0%, not a
    missing reading: denominators come from the rows, not from the brands.
    """
    opus_n, jev_n = len(_answered(record)), len(_answered(reading))
    if not opus_n:
        return "no usable Opus reading to compare"
    if not jev_n:
        return "no usable Jev reading to compare"
    before = {b.brand: b.rotation for b in brand_week(record)}
    after = {b.brand: b.rotation for b in brand_week(reading)}
    out = []
    for name in sorted(set(before) | set(after)):
        p, q = before.get(name, 0.0), after.get(name, 0.0)
        if p != q:
            out.append({"brand": name, "opus": p, "jev": q, "delta_points": round((q - p) * 100, 1),
                        "exceeds_noise": exceeds_noise(p, opus_n, q, jev_n)})
    return sorted(out, key=lambda r: (-abs(r["delta_points"]), r["brand"]))


def compare(record: dict, reading: dict, source: str, source_sha256: str | None = None) -> dict:
    """Per category and engine agreement, the disagreements, and Rotation effects."""
    if (reading.get("source") != source or reading["category"] != record["category"]
            or (source_sha256 and reading.get("source_sha256") != source_sha256)):
        raise ValueError(f"shadow reading does not belong to {source}")
    alias_data, _ = alias_policy(record)
    opus = {_identity(r): r for r in _renormalize(record["extractions"], AliasMap(
        alias_data.get("canonical", {}) or {}, alias_data.get("exclude", []) or []))}
    jev = {_identity(r): r for r in reading["extractions"]}

    quarantined = sorted({n for n in record.get("quarantined", []) if _key(n)}, key=lambda n: (-len(n), n))
    tallies: dict[str, Counter] = defaultdict(Counter)
    disagreements: dict[str, list] = defaultdict(list)
    for identity, o in opus.items():
        j = jev.get(identity)
        engine = identity[0]
        t = tallies[engine]
        if j is None or not o.get("answer", "").strip():
            t["not_comparable"] += 1
            continue
        if o.get("error") or j.get("error"):
            t["opus_error" if o.get("error") else "jev_error"] += 1
            continue
        t["compared"] += 1
        a = [b["name"] for b in sorted(o["brands"], key=lambda b: b["position"])]
        b = [x["name"] for x in sorted(j["brands"], key=lambda x: x["position"])]
        sa, sb = set(a), set(b)
        t["first"] += a[:1] == b[:1]
        t["exact"] += sa == sb
        t["intersection"] += len(sa & sb)
        t["union"] += len(sa | sb)
        t["refusal"] += o["refused"] == j["refused"]
        shared = sa & sb
        t["shared"] += len(shared)
        position = {x["name"]: x["position"] for x in o["brands"]}
        jposition = {x["name"]: x["position"] for x in j["brands"]}
        t["same_position"] += sum(position[n] == jposition[n] for n in shared)
        # Relative order of the brands both readers kept, the part of position
        # that does not depend on how many other brands each one listed.
        t["same_order"] += [n for n in a if n in shared] == [n for n in b if n in shared]

        link = {"source": source, "engine": engine, "question_id": identity[1], "run_index": identity[2]}
        roles, written = {}, {}
        for c in j.get("jev", {}).get("candidates", []):
            canonical = c.get("canonical") or c["name"]
            roles.setdefault(canonical, c.get("role"))
            written.setdefault(canonical, c["name"])
        for name in sorted(sb - sa):
            # Possible, not proven: the record's quarantine list has no answer
            # identities, so this only shows that every word of a quarantined
            # name occurs somewhere in this answer, not that Opus wrote it here.
            spelled = _key(written.get(name, name))
            words = set(_key(o.get("answer", "")).split())
            longer = next((q for q in quarantined if spelled in _key(q) and set(_key(q).split()) <= words), None)
            if longer:
                disagreements["jev_found_possible_quarantine_match"].append(
                    {**link, "brand": name, "possible_quarantined_name": longer})
            else:
                disagreements["jev_found_opus_missed"].append({**link, "brand": name})
        for name in sorted(sa - sb):
            role = roles.get(name, "never a candidate")
            disagreements[f"opus_listed_jev_called_{role.replace(' ', '_')}"].append({**link, "brand": name})
        osent = {x["name"]: x.get("sentiment") for x in o["brands"]}
        jsent = {x["name"]: x.get("sentiment") for x in j["brands"]}
        for name in sorted(shared):
            if osent[name] != jsent[name]:
                t["sentiment_flip"] += 1
                disagreements["sentiment_flip"].append({**link, "brand": name, "opus": osent[name], "jev": jsent[name]})
        if o["refused"] != j["refused"]:
            disagreements["refusal_flip"].append({**link, "opus": o["refused"], "jev": j["refused"]})

    def summary(t: Counter) -> dict:
        n = t["compared"]
        return {"compared": n, "jev_errors": t["jev_error"], "opus_errors": t["opus_error"],
                "not_comparable": t["not_comparable"],
                "first_brand": _rate(t["first"], n), "exact_set": _rate(t["exact"], n),
                "set_overlap": _rate(t["intersection"], t["union"]), "refusal": _rate(t["refusal"], n),
                "position_of_shared_brands": _rate(t["same_position"], t["shared"]),
                "order_of_shared_brands": _rate(t["same_order"], n),
                "sentiment_flips": t["sentiment_flip"], "counts": dict(t)}

    overall = sum(tallies.values(), Counter())
    rotation = _rotation(record, reading)
    answers = sum(1 for r in reading["extractions"] if r.get("jev", {}).get("requests"))
    return {
        "label": LABEL, "source": source, "published": source.startswith("data/runs/"),
        "category": record["category"], "run_date": record["run_date"], "reader": reading["reader"],
        "overall": summary(overall), "by_engine": {e: summary(t) for e, t in sorted(tallies.items())},
        "disagreement_counts": {k: len(v) for k, v in sorted(disagreements.items())},
        "disagreements": dict(disagreements),
        "rotation_changes": rotation,
        "rotation_beyond_noise": [r for r in rotation if r["exceeds_noise"]] if isinstance(rotation, list) else [],
        "cost": {"answers_read": answers, "input_tokens": reading["input_tokens"],
                 "dollars": round(reading["input_tokens"] / 1e6 * PRICE_PER_MTOK, 6),
                 "dollars_per_1k_answers": round(reading["input_tokens"] / 1e6 * PRICE_PER_MTOK / answers * 1000, 4)
                 if answers else None,
                 "opus_dollars_per_1k_answers": OPUS_DOLLARS_PER_1K,
                 "price_source": "https://docs.typesafe.ai/models ($0.042 per million input tokens; output free)",
                 "wall_clock_seconds": reading["elapsed_seconds"], "requests": reading["requests"]},
        "coverage": coverage(record),
    }


def _fresh_output(path: Path) -> Path:
    """Checked before any reading: paid work must never end in a refused write."""
    out = path.resolve()
    if out.is_relative_to((ROOT / "data").resolve()):
        raise SystemExit("output must be outside data/")
    if out.exists():
        raise SystemExit(f"{path} already exists; choose a new path")
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def _load_or_read(source: Path, read: bool, client, set_name: str) -> dict | None:
    target = shadow_path(source, set_name)
    if target.exists():
        return json.loads(target.read_text(encoding="utf-8"))
    if not read:
        return None
    from unprompted.jev_reader import read_record
    shadow = read_record(source, client)
    if shadow["errors"]:
        print(f"  {source.relative_to(ROOT)}: {shadow['errors']} answers failed; reading kept for review",
              file=sys.stderr)
    write_shadow(target, shadow)
    return shadow


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("coverage")
    run = commands.add_parser("compare")
    run.add_argument("--set", dest="set_name", required=True, help="reading set to compare, e.g. 2026-10-10")
    run.add_argument("--read", action="store_true", help="read records that have no shadow reading yet (paid)")
    run.add_argument("--out", type=Path)
    run.add_argument("--allow-partial", action="store_true", help="compare even if the set lacks some sources")
    alarm = commands.add_parser("alarm")
    alarm.add_argument("date")
    alarm.add_argument("--category", required=True)
    alarm.add_argument("--set", dest="set_name", help="reading set (default: the date)")
    args = parser.parse_args()

    if args.command == "coverage":
        out = {p.relative_to(ROOT).as_posix(): coverage(json.loads(p.read_text(encoding="utf-8")))
               for p in sources()}
        print(json.dumps(out, indent=2))
        return 0

    from unprompted.run import load_local_env
    set_name = reading_set(args.set_name or (args.date if args.command == "alarm" else None))
    out = _fresh_output(args.out) if getattr(args, "out", None) else None
    client = None
    if args.command == "alarm" or args.read:
        from unprompted.jev_reader import client as make_client
        load_local_env()
        client = make_client()

    if args.command == "alarm":
        # A second-reader alarm for a normal week. Writes to the shadow tree only;
        # it never holds, alters or reports into a published week.
        from unprompted.jev_reader import find_source
        source = find_source(args.date, args.category)
        shadow = _load_or_read(source, True, client, set_name)
        result = compare(json.loads(source.read_text(encoding="utf-8")), shadow, source.relative_to(ROOT).as_posix())
        brief = {k: result[k] for k in ("label", "source", "reader", "overall", "disagreement_counts",
                                         "rotation_beyond_noise")}
        write_shadow(shadow_path(source, set_name).with_suffix(".alarm.json"), brief)
        print(json.dumps(brief, indent=2))
        return 0

    results, missing = [], []
    for source in sources():
        raw = source.read_bytes()
        shadow = _load_or_read(source, args.read, client, set_name)
        if shadow is None:
            missing.append(source.relative_to(ROOT).as_posix())
            continue
        results.append(compare(json.loads(raw), shadow, source.relative_to(ROOT).as_posix(),
                               hashlib.sha256(raw).hexdigest()))
    if missing and not args.allow_partial:
        raise SystemExit(f"set {set_name} has no reading of: " + ", ".join(missing))
    payload = {"label": LABEL, "reading_set": set_name, "missing": missing, "results": results}
    if out:
        with out.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out}")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
