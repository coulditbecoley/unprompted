"""The event journal export (scripts/sync_analytics.py), against an in-memory stream.

urlopen is replaced, so no Redis is reached and the vault is a temp dir.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import scripts.sync_analytics as sa  # noqa: E402

NS = "a"


class FakeStream:
    def __init__(self):
        self.entries: list[tuple[str, list[str]]] = []
        self.calls: list[list[str]] = []
        self.error: str | None = None

    def add(self, stream_id: str, uuid: str, **fields):
        flat = ["id", uuid, "at", stream_id.split("-")[0], "path", "/", "missing", "false"]
        for k, v in fields.items():
            flat += [k, v]
        self.entries.append((stream_id, flat))

    def urlopen(self, request, timeout=None):
        cmd = json.loads(request.data)
        self.calls.append(cmd)
        if self.error:
            return io.BytesIO(json.dumps({"error": self.error}).encode())
        name, key = cmd[0], cmd[1]
        assert key == f"{NS}:events"
        rows = sorted(self.entries, key=lambda e: sa.sid(e[0]))
        if name == "XREVRANGE":
            result = [list(e) for e in rows[::-1][: int(cmd[5])]]
        elif name == "XRANGE":
            start, end, count = cmd[2], cmd[3], int(cmd[5])
            lo = sa.sid(start[1:]) if start.startswith("(") else sa.sid(start)
            hi = sa.sid(end)
            keep = [e for e in rows if (sa.sid(e[0]) > lo if start.startswith("(") else sa.sid(e[0]) >= lo)
                    and sa.sid(e[0]) <= hi]
            result = [list(e) for e in keep[:count]]
        else:
            raise AssertionError(f"unexpected command {cmd}")
        return io.BytesIO(json.dumps({"result": result}).encode())


@pytest.fixture
def stream(monkeypatch):
    fake = FakeStream()
    monkeypatch.setattr(sa.urllib.request, "urlopen", fake.urlopen)
    return fake


def lines(out_dir: Path) -> list[dict]:
    return [json.loads(line) for p in sorted((out_dir / "events").glob("*/*.jsonl"))
            for line in p.read_text(encoding="utf-8").splitlines()]


def cursor(out_dir: Path) -> dict:
    return json.loads((out_dir / "events/cursor.json").read_text(encoding="utf-8"))


def test_pages_across_many_events_once_each_and_never_trims(stream, tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "PAGE", 7)
    for i in range(50):
        stream.add(f"{1762000000000 + i * 60_000}-0", f"u{i}")
    assert sa.export_events("https://r", "t", tmp_path, NS) == (50, f"{1762000000000 + 49 * 60_000}-0")
    rows = lines(tmp_path)
    assert [r["id"] for r in rows] == [f"u{i}" for i in range(50)]
    assert rows[0]["missing"] is False and rows[0]["path"] == "/" and rows[0]["agent"] is None
    assert len(list((tmp_path / "events").glob("*/*.jsonl"))) == 8  # ceil(50/7)
    assert cursor(tmp_path)["last_id"] == rows[-1]["stream_id"]
    # Nothing new: a second run exports nothing and rewrites nothing.
    assert sa.export_events("https://r", "t", tmp_path, NS)[0] == 0
    assert len(lines(tmp_path)) == 50
    for cmd in stream.calls:
        assert cmd[0] in {"XRANGE", "XREVRANGE"}
        assert not {"MAXLEN", "MINID", "XTRIM", "XDEL", "DEL"} & {str(c).upper() for c in cmd}


def test_same_millisecond_events_stay_distinct_and_order_is_numeric(stream, tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "PAGE", 2)
    # 10 > 9 numerically but not as strings: a string compare would stall or skip.
    for seq in range(12):
        stream.add(f"1762000000000-{seq}", f"u{seq}")
    count, last = sa.export_events("https://r", "t", tmp_path, NS)
    assert count == 12 and last == "1762000000000-11"
    assert sorted((r["stream_id"] for r in lines(tmp_path)), key=sa.sid) == [f"1762000000000-{s}" for s in range(12)]


def test_duplicate_uuid_from_a_retried_xadd_is_exported_once(stream, tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "PAGE", 2)
    stream.add("1762000000000-0", "same")
    stream.add("1762000000001-0", "other")
    stream.add("1762000000002-0", "same")  # the retry, on a later page
    stream.add("1762000086400-0", "same")  # and again, a day later
    assert sa.export_events("https://r", "t", tmp_path, NS)[0] == 2
    assert sorted(r["id"] for r in lines(tmp_path)) == ["other", "same"]
    assert cursor(tmp_path)["last_id"] == "1762000086400-0"  # coverage still reaches the last entry


def test_crash_between_segment_and_cursor_does_not_duplicate(stream, tmp_path):
    for i in range(5):
        stream.add(f"{1762000000000 + i}-0", f"u{i}")
    real = sa._install

    def crash_on_cursor(path, text):
        if path.name == "cursor.json":
            raise OSError("power cut")
        real(path, text)

    sa._install = crash_on_cursor
    try:
        with pytest.raises(OSError):
            sa.export_events("https://r", "t", tmp_path, NS)
    finally:
        sa._install = real
    assert len(lines(tmp_path)) == 5 and not (tmp_path / "events/cursor.json").exists()
    stream.add("1762000000009-0", "u9")
    assert sa.export_events("https://r", "t", tmp_path, NS) == (1, "1762000000009-0")
    assert sorted(r["id"] for r in lines(tmp_path)) == ["u0", "u1", "u2", "u3", "u4", "u9"]


def test_stream_reset_is_reported_and_the_cursor_does_not_jump(stream, tmp_path):
    stream.add("1762000000000-0", "u0")
    sa.export_events("https://r", "t", tmp_path, NS)
    stream.entries.clear()  # stream deleted or replaced
    with pytest.raises(sa.Unreachable, match="stream reset"):
        sa.export_events("https://r", "t", tmp_path, NS)
    stream.add("1700000000000-0", "older")  # recreated with ids behind the cursor
    with pytest.raises(sa.Unreachable, match="stream reset"):
        sa.export_events("https://r", "t", tmp_path, NS)
    assert cursor(tmp_path)["last_id"] == "1762000000000-0"


def test_corrupt_segment_is_reported_not_overwritten(stream, tmp_path):
    stream.add("1762000000000-0", "u0")
    sa.export_events("https://r", "t", tmp_path, NS)
    segment = next((tmp_path / "events").glob("*/*.jsonl"))
    segment.write_text("{broken", encoding="utf-8")
    with pytest.raises(sa.Unreachable, match="corrupt segment"):
        sa.export_events("https://r", "t", tmp_path, NS)
    assert segment.read_text(encoding="utf-8") == "{broken"


def test_error_envelope_fails_the_run_and_status_records_it(stream, tmp_path, monkeypatch):
    stream.error = "WRONGTYPE Operation against a key holding the wrong kind of value"
    with pytest.raises(sa.Unreachable, match="WRONGTYPE"):
        sa.export_events("https://r", "t", tmp_path, NS)

    import unprompted.storage as storage
    recorded = {}
    monkeypatch.setattr(storage, "record_status", lambda *a, **kw: recorded.update(args=a, **kw))
    monkeypatch.setattr(sa, "load_local_env", lambda: None)
    monkeypatch.setattr(sa, "fetch_day", lambda *a: {})
    monkeypatch.setenv("KV_REST_API_URL", "https://r")
    monkeypatch.setenv("KV_REST_API_TOKEN", "t")
    monkeypatch.delenv("ANALYTICS_NAMESPACE", raising=False)
    (tmp_path / "vault").mkdir()
    monkeypatch.setattr(sys, "argv", ["sync_analytics.py", "--vault", str(tmp_path / "vault"), "--days", "1"])
    assert sa.main() == 1
    assert recorded["args"][2] is False

    stream.error = None
    stream.add("1762000000000-0", "u0")
    assert sa.main() == 0
    assert recorded["args"][2] is True
    assert recorded["events_exported"] == 1 and recorded["stream_last_id"] == "1762000000000-0"


def test_namespace_mirrors_the_site(monkeypatch):
    monkeypatch.delenv("ANALYTICS_NAMESPACE", raising=False)
    assert sa.namespace() == "a"
    monkeypatch.setenv("ANALYTICS_NAMESPACE", "test-abcdefgh")
    assert sa.namespace() == "test-abcdefgh"
    monkeypatch.setenv("ANALYTICS_NAMESPACE", "unprompted")
    with pytest.raises(sa.Unreachable):
        sa.namespace()
