"""A paid, private analysis of one brand in one category, from the public archive.

    python -m unprompted.brand_report ai-coding-assistants "Cursor" [--through 2026-10-28]

Everything here is already public in data/runs; the report packages it into
breakdowns a brand would otherwise assemble by hand. It never makes a provider
call, never reads data/held, and writes only under private/ (gitignored, and
outside both `git add data reports` and the vault sync). MONETIZATION-PLAN.md
section 6 is the spec; the counting follows lib/metrics.ts `answered` and
`standings`, and integer counts are the authority.
"""

from __future__ import annotations

import argparse
import html
import re
import subprocess
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import median
from urllib.parse import urlsplit

import yaml

from .aggregate import brand_week, comparison_reason, load_affiliations, load_history, self_preference, source_counts
from .storage import write_text

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / "private"


def categories() -> set[str]:
    return {p.stem for p in (ROOT / "questions").glob("*.yml")}


def measured(run: dict) -> str:
    return run.get("measured_on") or run["run_date"]


def bucket(e: dict) -> str:
    """error, refusal or answered, exactly as lib/metrics.ts `answered` splits them."""
    if not (e.get("error") is None or isinstance(e.get("error"), str)) or not isinstance(e.get("refused", False), bool):
        raise ValueError(f"malformed extraction {e.get('engine')}/{e.get('question_id')}/{e.get('run_index')}")
    return "error" if e.get("error") else "refusal" if e.get("refused") else "answered"


def _hit(e: dict, brand: str) -> dict | None:
    return next((b for b in e.get("brands", []) if b["name"] == brand), None)


def tally(rows: list[dict], brand: str) -> dict:
    """Counts for one subset of answered rows. Rates are None when n is 0."""
    hits = [h for h in (_hit(e, brand) for e in rows) if h]
    first = sum(1 for h in hits if h["position"] == 1)
    n = len(rows)
    return {"n": n, "named": len(hits), "first": first,
            "rate": len(hits) / n if n else None, "first_share": first / n if n else None,
            "median_position": median(h["position"] for h in hits) if hits else None}


def history(category: str, through: str | None = None) -> list[dict]:
    """Published measurements through a date, each in its latest reading."""
    if category not in categories():
        raise ValueError(f"unknown category: {category}")
    runs = load_history(ROOT / "data" / "runs", category)
    if through:
        if date.fromisoformat(through).isoformat() != through:
            raise ValueError("--through must be YYYY-MM-DD")
        runs = [r for r in runs if measured(r) <= through]
    if not runs:
        raise ValueError(f"no published measurements for {category}" + (f" through {through}" if through else ""))
    return runs


def analyse(category: str, brand: str, through: str | None = None) -> dict:
    runs = history(category, through)
    if not any(b.brand == brand for r in runs for b in brand_week(r)):
        raise ValueError(f"{brand!r} is not named in any published {category} measurement in range")
    for r in runs:
        for e in r.get("extractions", []):
            bucket(e)

    weeks, previous = [], None
    for r in runs:
        row = next((b for b in brand_week(r) if b.brand == brand), None)
        answered = [e for e in r["extractions"] if bucket(e) == "answered"]
        weeks.append({"measured": measured(r), "read": r["run_date"], "reading_sha": r.get("git_sha") or None,
                      "measurement_shas": sorted({e.get("measurement_git_sha") for e in r["extractions"]
                                                  if e.get("measurement_git_sha")}),
                      "n": len(answered), "named": row.named if row else 0, "first": row.first_named if row else 0,
                      "rank": next((i for i, b in enumerate(brand_week(r), 1) if b.brand == brand), None),
                      "snapshot": bool(r.get("methodology")),
                      "comparable": (comparison_reason(r, previous) if previous else "first measurement in range")
                      or (None if r.get("methodology") and previous.get("methodology")
                          else "comparable on recorded fields; one side has no configuration snapshot")})
        previous = r

    latest = runs[-1]
    rows = latest["extractions"]
    answered = [e for e in rows if bucket(e) == "answered"]
    order = list(dict.fromkeys(e["question_id"] for e in answered))
    snapshot = {q["id"]: q["text"] for q in (latest.get("methodology", {}).get("questions") or {}).get("questions", [])}
    bank = yaml.safe_load((ROOT / "questions" / f"{category}.yml").read_text(encoding="utf-8")) or {}
    current = {q["id"]: q["text"] + " (current wording; not recorded in this run)" for q in bank.get("questions", [])}

    questions = []
    for qid in order:
        subset = [e for e in answered if e["question_id"] == qid]
        others = Counter(b["name"] for e in subset if not _hit(e, brand)
                         for b in {b["name"]: b for b in e.get("brands", [])}.values())
        questions.append({"id": qid, "text": snapshot.get(qid) or current.get(qid), **tally(subset, brand),
                          "without": sum(1 for e in subset if not _hit(e, brand)),
                          "instead": sorted(others.items(), key=lambda kv: (-kv[1], kv[0]))[:5]})

    engines = []
    for name in sorted({e["engine"] for e in rows}):
        mine = [e for e in rows if e["engine"] == name]
        kinds = Counter(bucket(e) for e in mine)
        engines.append({"engine": name, "attempted": len(mine), "errors": kinds["error"],
                        "refusals": kinds["refusal"], **tally([e for e in mine if bucket(e) == "answered"], brand)})

    present = {**latest, "extractions": [e for e in answered if _hit(e, brand)]}
    absent = {**latest, "extractions": [e for e in answered if not _hit(e, brand)]}

    examples = []
    for name in sorted({e["engine"] for e in rows}):
        pick = next((e for qid in order for e in sorted(answered, key=lambda e: e["run_index"])
                     if e["engine"] == name and e["question_id"] == qid and (e.get("answer") or "").strip()), None)
        examples.append({"engine": name, "question_id": pick and pick["question_id"],
                         "run_index": pick and pick["run_index"], "answer": pick and pick["answer"],
                         "names_brand": bool(pick and _hit(pick, brand))})

    affiliations = load_affiliations(ROOT / "aliases" / f"{category}.yml", run=latest)
    return {"category": category, "brand": brand, "through": through or measured(latest), "weeks": weeks,
            "latest": {"measured": measured(latest), "read": latest["run_date"], "attempted": len(rows),
                       "answered": len(answered), **tally(answered, brand)},
            "questions": questions, "engines": engines,
            "sources": {"present": (len(present["extractions"]), source_counts(present)[:15]),
                        "absent": (len(absent["extractions"]), source_counts(absent)[:15])},
            "self_preference": [s.to_dict() if hasattr(s, "to_dict") else vars(s)
                                for s in self_preference(latest, affiliations) if s.brand == brand],
            "examples": examples, "archive_commit": _archive_commit()}


def _archive_commit() -> str:
    try:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "data"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return sha + (" (data/ has uncommitted changes)" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "not recorded"


# --- rendering --------------------------------------------------------------

def esc(value) -> str:
    return html.escape("not recorded" if value is None else str(value), quote=True)


def link(url: str) -> str:
    """A safe anchor for http(s) URLs with a host and no credentials; text otherwise."""
    try:
        parts = urlsplit(url)
        ok = (parts.scheme in ("http", "https") and parts.hostname and not parts.username
              and not parts.password and not re.search(r"[\x00-\x20\x7f]", url))
    except ValueError:
        ok = False
    return f'<a href="{esc(url)}" rel="nofollow noreferrer">{esc(url)}</a>' if ok else esc(url)


def pct(part: int, whole: int) -> str:
    return "rate unavailable" if not whole else f"{part / whole:.0%} ({part} of {whole})"


def render(d: dict) -> str:
    L = d["latest"]
    week_rows = "".join(
        f"<tr><td>{esc(w['measured'])}</td><td>{esc(w['read'])}</td><td>{esc(w['rank'] or 'not named')}</td>"
        f"<td>{pct(w['named'], w['n'])}</td><td>{pct(w['first'], w['n'])}</td>"
        f"<td>{'comparable with the previous row' if w['comparable'] is None else esc(w['comparable'])}</td>"
        f"<td><small>reading {esc(w['reading_sha'])}<br>measurement {esc(', '.join(w['measurement_shas']) or None)}"
        f"<br>{'configuration snapshot recorded' if w['snapshot'] else 'no configuration snapshot (legacy)'}</small></td></tr>"
        for w in d["weeks"])
    q_rows = "".join(
        f"<tr><td>{esc(q['id'])}</td><td>{esc(q['text'] or 'wording not recorded in this run')}</td>"
        f"<td>{pct(q['named'], q['n'])}</td><td>{pct(q['first'], q['n'])}</td>"
        f"<td>{esc(', '.join(f'{b} ({c})' for b, c in q['instead']) or '-')}"
        f"<br><small>among the {q['without']} answers that did not name {esc(d['brand'])}</small></td></tr>"
        for q in d["questions"])
    e_rows = "".join(
        f"<tr><td>{esc(e['engine'])}</td><td>{e['attempted']}</td><td>{e['errors']}</td><td>{e['refusals']}</td>"
        f"<td>{pct(e['named'], e['n'])}</td><td>{pct(e['first'], e['n'])}</td></tr>" for e in d["engines"])

    def sources(key: str) -> str:
        n, rows = d["sources"][key]
        items = "".join(f"<li>{esc(host)}: {count}</li>" for host, count in rows) or "<li>none recorded</li>"
        return f"<p>{n} answers.</p><ol>{items}</ol>"

    sp = "".join(
        f"<p>{esc(s['engine'])} named it in {pct(s['own_named'], s['own_runs'])} of its own answers; "
        f"other engines in {pct(s['rival_named'], s['rival_runs'])}.</p>" for s in d["self_preference"])
    examples = "".join(
        f"<h3>{esc(x['engine'])}</h3>" + (
            f"<p class=meta>{esc(x['question_id'])}, ask {esc(x['run_index'])}, measured {esc(L['measured'])}; "
            f"{'names' if x['names_brand'] else 'does not name'} {esc(d['brand'])}. Chosen as the first recorded "
            f"answer, not as representative.</p><pre>{esc(x['answer'])}</pre>" if x["answer"] else "<p>Example not recorded.</p>")
        for x in d["examples"])
    questions_to_investigate = "".join(
        f"<li>{esc(q['id'])}: named in {pct(q['named'], q['n'])}. Which pages do the engines cite when they "
        f"name {esc(', '.join(b for b, _ in q['instead'][:3]))} here instead?</li>"
        for q in sorted(d["questions"], key=lambda q: (q["rate"] if q["rate"] is not None else 2))[:3])

    return f"""<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>{esc(d['brand'])} · {esc(d['category'])} · Unprompted brand report</title>
<style>body{{font:15px/1.55 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 16px;color:#111;background:#fff}}
table{{border-collapse:collapse;width:100%;margin:1rem 0;font-size:13px}}td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}}
pre{{white-space:pre-wrap;background:#f6f6f6;padding:12px;font-size:13px}}.meta,small{{color:#555}}h2{{margin-top:2.2rem}}</style></head><body>
<p class=meta>Unprompted · private brand report · prepared from the public archive</p>
<h1>{esc(d['brand'])} in {esc(d['category'])}</h1>
<p>Measurements through <b>{esc(d['through'])}</b>, as read on the archive commit below. In the latest
measurement ({esc(L['measured'])}), {esc(d['brand'])} was named in {pct(L['named'], L['n'])} answered asks and named first in
{pct(L['first'], L['n'])}. {L['attempted'] - L['answered']} of {L['attempted']} asks were errors or refusals and are excluded.</p>

<h2>Every published week</h2>
<table><tr><th>Measured</th><th>Read</th><th>Rank</th><th>Named</th><th>Named first</th><th>Comparison</th><th>Provenance</th></tr>{week_rows}</table>

<h2>By question (latest week)</h2>
<table><tr><th>ID</th><th>Question</th><th>Named</th><th>First</th><th>Named instead</th></tr>{q_rows}</table>

<h2>By engine (latest week)</h2>
<table><tr><th>Engine</th><th>Asked</th><th>Errors</th><th>Refusals</th><th>Named</th><th>First</th></tr>{e_rows}</table>
{('<h2>Own-house preference</h2>' + sp) if sp else ''}

<h2>Domains cited in answers (latest week)</h2>
<p class=meta>URL occurrences in the engines' answers, split by whether the answer named {esc(d['brand'])}.
These are pages the engines cited while answering, not citations for a particular brand.</p>
<h3>Answers that named {esc(d['brand'])}</h3>{sources('present')}
<h3>Answers that did not</h3>{sources('absent')}

<h2>Example answers</h2>{examples}

<h2>Questions to investigate</h2>
<p>Observations, not causes. The archive records what engines said, not why.</p>
<ol>{questions_to_investigate}</ol>
<p class=meta>The question bank is fixed and public, so tuning content to these exact questions could move this
benchmark without improving visibility in general. Read movement here with that in mind.</p>
<p>Want help acting on this? Skald Studio offers AI-visibility consultations. Paying for one never changes what
Unprompted measures or publishes.</p>

<h2>Method and provenance</h2>
<ul><li>Counts are the authority; every percentage shows its count. Repeated asks of one engine are not
independent, so no confidence intervals are given.</li>
<li>Usable answer = no error and not a recorded refusal (the site's definition).</li>
<li>Some boundary cases of week-over-week significance can be classed differently on the website, which keeps
full precision where this report follows the pipeline's rounding.</li>
<li>Brand names follow each run's recorded alias map; weeks marked "no configuration snapshot" predate that
record, and own-house figures for them use the current alias file.</li>
<li>Archive commit: {esc(d['archive_commit'])}</li>
<li>Reading and measurement commits for each week are in the first table.</li></ul>
</body></html>
"""


def private_path(*parts: str) -> Path:
    """A path under private/, refused if it resolves (junction, symlink, ..) anywhere
    the weekly commit or the vault sync would collect it."""
    path = PRIVATE.joinpath(*parts).resolve()
    if (not path.is_relative_to(PRIVATE.resolve())
            or any(path.is_relative_to((ROOT / d).resolve()) for d in ("data", "reports"))):
        raise ValueError(f"private output would land outside private/: {path}")
    return path


def output_path(category: str, brand: str, through: str) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", brand.lower()).strip("-")[:60] or "brand"
    return private_path("brand", category, f"{slug}-{through}.html")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("category")
    parser.add_argument("brand")
    parser.add_argument("--through", help="include measurements on or before this date (YYYY-MM-DD)")
    args = parser.parse_args()
    data = analyse(args.category, args.brand, args.through)
    path = output_path(args.category, args.brand, data["through"])
    write_text(path, render(data))
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
