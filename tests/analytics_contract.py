"""The analytics contract: one event in, exactly these counters out.

Not a unit test. It drives a running build and a real Redis, because every
fault this has caught lived in the seam between them -- a branch that wrote the
wrong field, a guard that existed only in the browser, a miss filed as a page
view. A mocked Redis would have passed all of them.

Isolation is the point. Each case clears the day, sends exactly one thing, and
compares the *whole* hash. Reading totals after a burst of traffic cannot see
double counting or cross-contamination, which is how those faults survived
three earlier rounds of checking.

    npm run build && npx next start -p 3577      # in another terminal
    python tests/analytics_contract.py

Deliberately not named test_*.py. Pytest would import it, run it at collection
time, and the clean exit it takes when no server is listening would abort the
whole collection -- which it did, silently turning 106 passing tests into "no
tests ran". A script that needs a running server is not a unit test and should
not pretend to be one.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:3577"
DAY = time.strftime("%Y-%m-%d", time.gmtime())

env = {}
for line in (REPO / ".env.local").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
URL = env["KV_REST_API_URL"].rstrip("/")
TOK = env["KV_REST_API_TOKEN"]

BROWSER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def redis(*parts: str, body: bytes | None = None) -> object:
    path = "/".join(urllib.parse.quote(p, safe="") for p in parts)
    req = urllib.request.Request(
        f"{URL}/{path}",
        headers={"Authorization": f"Bearer {TOK}"},
        data=body,
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read()).get("result")


def clear() -> None:
    for key in (f"a:d:{DAY}", "a:feed", "a:seen"):
        redis("del", key, body=b"")


def counters() -> dict[str, int]:
    flat = redis("hgetall", f"a:d:{DAY}") or []
    return {flat[i]: int(flat[i + 1]) for i in range(0, len(flat) - 1, 2)}


def get(path: str, ua: str = BROWSER) -> int:
    req = urllib.request.Request(BASE + path, headers={"User-Agent": ua})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def track(payload: dict, ua: str = BROWSER) -> int:
    req = urllib.request.Request(
        BASE + "/api/track",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": ua},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.status


RESULTS: list[tuple[bool, str, str]] = []


def case(name: str, expected: dict[str, int], actual: dict[str, int]) -> None:
    ok = expected == actual
    detail = ""
    if not ok:
        missing = {k: v for k, v in expected.items() if actual.get(k) != v}
        extra = {k: v for k, v in actual.items() if k not in expected}
        detail = f"wrong/missing={missing} unexpected={extra}"
    RESULTS.append((ok, name, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    if detail:
        print(f"        {detail}")


NUL = "\x00"

try:
    urllib.request.urlopen(BASE, timeout=5).read()
except Exception:
    print(f"no server on {BASE}; skipping the analytics contract")
    raise SystemExit(0)

print(f"analytics contract against {BASE}, day {DAY}\n")

# 1 -- a named agent reading a real page ------------------------------------
clear()
get("/consensus", "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")
time.sleep(2.5)
case(
    "agent page view writes exactly five fields, counted once",
    {
        "g:GPTBot": 1,
        "p:training": 1,
        f"gp:GPTBot{NUL}/consensus": 1,
        "t:agent": 1,
    },
    counters(),
)

# 2 -- a named agent asking for something that is not here -------------------
clear()
get("/wp-admin", "Mozilla/5.0 (compatible; ClaudeBot/1.0)")
time.sleep(2.5)
case(
    "agent miss adds x: and does not add a human view",
    {
        "g:ClaudeBot": 1,
        "p:training": 1,
        f"gp:ClaudeBot{NUL}/wp-admin": 1,
        "t:agent": 1,
        "x:/wp-admin": 1,
    },
    counters(),
)

# 3 -- a person asking for something that is not here ------------------------
clear()
get("/definitely-not-here")
time.sleep(2.5)
case(
    "human miss records only the miss, not a page view",
    {"x:/definitely-not-here": 1},
    counters(),
)

# 4 -- a person reading a real page ------------------------------------------
clear()
track({"path": "/chart/ai-coding-assistants", "referrer": None})
time.sleep(2.5)
case(
    "human page view",
    {"v:/chart/ai-coding-assistants": 1, "t:human": 1},
    counters(),
)

# 5 -- referred by an assistant ----------------------------------------------
clear()
track({"path": "/", "referrer": "https://chatgpt.com/c/abc"})
time.sleep(2.5)
case(
    "assistant referrer stored as a bare hostname",
    {"v:/": 1, "t:human": 1, "r:chatgpt.com": 1},
    counters(),
)

# 6 -- a click ----------------------------------------------------------------
clear()
track({"path": "/", "event": "share:copy"})
time.sleep(2.5)
case("click records only the click", {"c:share:copy": 1}, counters())

# 7 -- a comparison ------------------------------------------------------------
clear()
track({"path": "/compare", "query": "a=Cursor&b=Claude Code&c=ai-coding-assistants"})
time.sleep(2.5)
case(
    "comparison records the pair and the page view",
    {"v:/compare": 1, "t:human": 1, "m:Claude Code vs Cursor": 1},
    counters(),
)

# 8 -- a brand page -------------------------------------------------------------
clear()
track({"path": "/brand/ai-coding-assistants/cursor", "referrer": None})
time.sleep(2.5)
case(
    "brand page rolls up",
    {
        "v:/brand/ai-coding-assistants/cursor": 1,
        "t:human": 1,
        "b:cursor (ai-coding-assistants)": 1,
    },
    counters(),
)

# 9 -- the beacon endpoint must not count itself --------------------------------
clear()
track({"path": "/", "referrer": None})
time.sleep(2.5)
c = counters()
case(
    "the beacon endpoint is not itself counted",
    {"v:/": 1, "t:human": 1},
    c,
)

# 10 -- an agent calling the beacon is refused ----------------------------------
clear()
track({"path": "/", "referrer": None}, "Mozilla/5.0 (compatible; GPTBot/1.2)")
time.sleep(2.5)
case("an agent cannot post to the human beacon", {}, counters())

# 11 -- admin traffic ------------------------------------------------------------
clear()
get("/admin")
time.sleep(2.5)
case("operator's own admin visits are not counted", {}, counters())

# 12 -- a comparison of a brand against itself -----------------------------------
clear()
track({"path": "/compare", "query": "a=Cursor&b=Cursor"})
time.sleep(2.5)
case(
    "a brand compared with itself is not a comparison",
    {"v:/compare": 1, "t:human": 1},
    counters(),
)

# 13 -- junk in the query --------------------------------------------------------
clear()
track({"path": "/compare", "query": "a=X&b=Y&secret=hunter2&utm_source=spam"})
time.sleep(2.5)
c = counters()
leaked = [k for k in c if "hunter2" in k or "utm" in k or "spam" in k]
RESULTS.append((not leaked, "only the addressing keys are kept from a query", str(leaked)))
print(f"  {'PASS' if not leaked else 'FAIL'}  only the addressing keys are kept from a query")

# 14 -- cadence -------------------------------------------------------------------
clear()
get("/", "Mozilla/5.0 (compatible; PerplexityBot/1.0)")
time.sleep(1.5)
get("/", "Mozilla/5.0 (compatible; PerplexityBot/1.0)")
time.sleep(2.5)
seen = redis("hgetall", "a:seen") or []
pairs = {seen[i]: seen[i + 1] for i in range(0, len(seen) - 1, 2)}
first, last = pairs.get("PerplexityBot:first"), pairs.get("PerplexityBot:last")
ok = bool(first and last and int(last) > int(first))
RESULTS.append((ok, "cadence keeps first fixed and moves last", f"first={first} last={last}"))
print(f"  {'PASS' if ok else 'FAIL'}  cadence keeps first fixed and moves last")

# 15 -- a brand page read by an agent is counted apart from a person's --------------
clear()
get("/brand/ai-coding-assistants/cursor", "Mozilla/5.0 (compatible; GPTBot/1.2)")
time.sleep(2.5)
c = counters()
case(
    "an agent reading a brand page does not inflate human look-ups",
    {
        "g:GPTBot": 1,
        "p:training": 1,
        f"gp:GPTBot{NUL}/brand/ai-coding-assistants/cursor": 1,
        "t:agent": 1,
        "ba:cursor (ai-coding-assistants)": 1,
    },
    c,
)

# 16 -- a miss on a brand-shaped path is not a brand look-up ------------------------
clear()
get("/brand/ai-coding-assistants/not-a-real-brand-xyz")
time.sleep(2.5)
c = counters()
ok = not any(k.startswith("b:") or k.startswith("ba:") for k in c)
RESULTS.append((ok, "a miss under /brand does not count as a look-up", str(c)))
print(f"  {'PASS' if ok else 'FAIL'}  a miss under /brand does not count as a look-up")

# 17 -- the operator is not the audience, from either side -------------------------
clear()
track({"path": "/admin", "referrer": None})
time.sleep(2.5)
case("an /admin view is refused server-side too", {}, counters())

clear()
get("/admin", "Mozilla/5.0 (compatible; GPTBot/1.2)")
time.sleep(2.5)
case("an agent probing /admin is not audience either", {}, counters())

# 18 -- a search engine is not an assistant -----------------------------------------
clear()
track({"path": "/", "referrer": "https://www.bing.com/search?q=x"})
time.sleep(2.5)
c = counters()
ok = c.get("r:bing.com") == 1
RESULTS.append((ok, "a search referrer is still recorded as a referrer", str(c)))
print(f"  {'PASS' if ok else 'FAIL'}  a search referrer is still recorded as a referrer")

# 19 -- static assets must not be counted ------------------------------------------
clear()
get("/sitemap.xml", "Mozilla/5.0 (compatible; GPTBot/1.2)")
time.sleep(2.5)
case("excluded paths are not counted", {}, counters())

clear()
print()
passed = sum(1 for ok, _, _ in RESULTS if ok)
print(f"{passed}/{len(RESULTS)} passed")
for ok, name, detail in RESULTS:
    if not ok:
        print(f"  FAILED: {name}\n          {detail}")
sys.exit(0 if passed == len(RESULTS) else 1)
