import importlib.util
import json
from pathlib import Path
import sys
import time

import pytest
from unprompted.storage import run_lock

SPEC = importlib.util.spec_from_file_location("evidence_backup", Path(__file__).resolve().parents[1] / "scripts/backup.py")
b = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(b)


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    roots = {name: repo / name for name in (".unprompted", "data", "private")}
    for root in roots.values():
        root.mkdir()
    (roots["data"] / "reading.json").write_text('paid evidence')
    monkeypatch.setattr(b, "REPO", repo)
    monkeypatch.setattr(b, "sources", lambda: roots)
    return repo, roots, tmp_path / "backup"


def latest(dest):
    return json.loads(max((dest / "snapshots").glob("*.json"), key=lambda p: p.stat().st_mtime_ns).read_text())


def test_dedupe_append_only_and_restore(fixture):
    repo, roots, dest = fixture
    assert b.main(["--dest", str(dest)]) == 0
    objects = set((dest / "objects").rglob("*"))
    snapshots = set((dest / "snapshots").iterdir())
    assert b.main(["--dest", str(dest)]) == 0
    assert snapshots < set((dest / "snapshots").iterdir())
    assert objects <= set((dest / "objects").rglob("*"))
    sha = latest(dest)["sources"]["data"]["reading.json"]["sha"]
    assert len(list((dest / "objects").rglob(sha))) == 1
    assert b.main(["--restore-check", "--dest", str(dest)]) == 0
    assert (roots["data"] / "reading.json").read_text() == 'paid evidence'


def test_corrupt_object_repaired_and_restore_detects_corruption(fixture):
    _, _, dest = fixture
    assert b.main(["--dest", str(dest)]) == 0
    entry = latest(dest)["sources"]["data"]["reading.json"]
    obj = b.object_path(dest, entry["sha"])
    obj.write_text("corrupt")
    assert b.main(["--restore-check", "--dest", str(dest)]) != 0
    assert b.main(["--dest", str(dest)]) == 0
    assert obj.read_text() == "paid evidence"


def test_interrupted_object_never_installed(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.write_text("bytes")
    deadline = time.monotonic() + 30
    sha, size = b.digest(source, deadline)
    def fail(*args):
        raise OSError("interrupted rename")
    monkeypatch.setattr(b.os, "replace", fail)
    dest = tmp_path / "dest"
    with pytest.raises(OSError):
        b.install_object(source, dest, sha, size, deadline)
    assert not b.object_path(dest, sha).exists()
    assert not list(dest.rglob(".pending-*.tmp"))


def test_changing_file_retried_then_incomplete(fixture, monkeypatch):
    _, roots, dest = fixture
    original = b.install_object
    attempts = []
    def change(source, *args):
        original(source, *args)
        if source == roots["data"] / "reading.json":
            attempts.append(1)
            source.write_text(source.read_text() + "changed")
    monkeypatch.setattr(b, "install_object", change)
    assert b.main(["--dest", str(dest)]) == 2
    assert len(attempts) == 2
    assert latest(dest)["incomplete"]
    assert not latest(dest)["sources"]["data"]


def test_exclusions_and_missing_optional(fixture):
    _, roots, dest = fixture
    for name in (".env.local", "auth", "secret.pem", "credentials-old", "test.lock", ".pending-a.tmp", "__pycache__"):
        directory = roots["data"] / name
        directory.mkdir()
        (directory / "never-read").write_text("excluded")
    roots["optional"] = dest.parent / "absent"
    assert b.main(["--dest", str(dest)]) == 0
    manifest = latest(dest)
    assert all(manifest["excluded"][rule] >= 1 for rule in b.RULES)
    assert set(manifest["sources"]["data"]) == {"reading.json"}
    assert manifest["missing_optional"] == ["optional"]


def test_symlink_not_followed(fixture):
    _, roots, dest = fixture
    outside = dest.parent / "outside"
    outside.mkdir()
    (outside / "secret").write_text("never copied")
    try:
        (roots["data"] / "link").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("symlink creation unavailable")
    assert b.main(["--dest", str(dest)]) == 0
    assert latest(dest)["excluded"]["symlink/junction"] == 1
    assert "link/secret" not in latest(dest)["sources"]["data"]


@pytest.mark.parametrize("name", ["week.lock", "run.lock"])
def test_busy_lock_skips_roots(fixture, name):
    repo, _, dest = fixture
    with run_lock(repo / ".unprompted", name):
        assert b.main(["--dest", str(dest)]) == 2
    assert set(latest(dest)["skipped_roots"]) == {".unprompted", "data"}


def test_failed_destination_does_not_stop_other_and_status_keeps_success(fixture):
    repo, _, dest = fixture
    assert b.main(["--dest", str(dest)]) == 0
    status = repo / ".unprompted/status/backup.json"
    success = json.loads(status.read_text())["last_success"]
    blocked = dest.parent / "blocked"
    blocked.write_text("not a directory")
    assert b.main(["--dest", str(blocked), "--dest", str(dest)]) == 2
    current = json.loads(status.read_text())
    assert current["last_success"] == success and not current["ok"]
    assert current["destinations"][1]["local_complete"]


def test_deadline_and_restore_traversal(fixture):
    _, _, dest = fixture
    assert b.main(["--dest", str(dest), "--deadline", "0"]) == 1
    assert b.main(["--dest", str(dest)]) == 0
    path = max((dest / "snapshots").glob("*.json"), key=lambda p: p.stat().st_mtime_ns)
    manifest = json.loads(path.read_text())
    manifest["sources"]["data"]["../../escape"] = manifest["sources"]["data"].pop("reading.json")
    path.write_text(json.dumps(manifest))
    assert b.main(["--restore-check", "--dest", str(dest)]) != 0
    assert not (dest.parent / "escape").exists()

@pytest.mark.skipif(sys.platform != "win32", reason="real Windows cmd integration")
@pytest.mark.parametrize("weekday,backup_exit,restore_exit,expected", [(1, 2, 0, 2), (6, 0, 2, 2), (6, 0, 0, 0)])
def test_daily_hook_runs_backup_and_sunday_restore(tmp_path, weekday, backup_exit, restore_exit, expected):
    import os
    import subprocess
    import venv
    repo = tmp_path / "fake repo"
    (repo / "scripts").mkdir(parents=True)
    venv.EnvBuilder(with_pip=False).create(repo / ".venv")
    launcher = (Path(__file__).resolve().parents[1] / "scripts/sync-vault.cmd").read_text(encoding="utf-8-sig")
    launcher = launcher.replace("datetime.date.today().weekday()", str(weekday))
    (repo / "scripts/sync-vault.cmd").write_text(launcher)
    for name in ("publish.py", "sync_vault.py", "sync_analytics.py"):
        (repo / "scripts" / name).write_text("raise SystemExit(0)\n")
    (repo / "scripts/backup.py").write_text(
        "import sys\nfrom pathlib import Path\n"
        "with Path('calls').open('a') as f: f.write(' '.join(sys.argv[1:])+'\\n')\n"
        f"raise SystemExit({restore_exit} if '--restore-check' in sys.argv else {backup_exit})\n")
    result = subprocess.run(["cmd.exe", "/d", "/c", "scripts\\sync-vault.cmd"], cwd=repo,
                            env={**os.environ, "TEMP": str(tmp_path)}, capture_output=True, text=True, timeout=60)
    assert result.returncode == expected, result.stdout + result.stderr
    assert (repo / "calls").read_text().splitlines() == (["", "--restore-check"] if weekday == 6 else [""])

@pytest.mark.skipif(sys.platform != "win32", reason="Windows junction")
def test_junction_not_followed(fixture):
    import subprocess
    _, roots, dest = fixture
    outside = dest.parent / "junction-target"
    outside.mkdir()
    (outside / "secret").write_text("never copied")
    junction = roots["data"] / "junction"
    made = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(outside)],
                          capture_output=True, text=True)
    if made.returncode:
        pytest.skip("junction creation unavailable")
    try:
        assert b.main(["--dest", str(dest)]) == 0
        assert latest(dest)["excluded"]["symlink/junction"] == 1
        assert "junction/secret" not in latest(dest)["sources"]["data"]
    finally:
        junction.rmdir()  # Remove only the junction itself, never the target.

@pytest.mark.skipif(sys.platform != "win32", reason="real cmd log rotation")
def test_log_rotation_preserves_each_generation(tmp_path):
    import os
    import subprocess
    launcher = (Path(__file__).resolve().parents[1] / "scripts/weekly-run.cmd").read_text()
    line = next(line for line in launcher.splitlines() if "p.rename(p.with_name('weekly-'" in line)
    script = tmp_path / "rotate.cmd"
    script.write_text("@echo off\n" + line + "\n")
    log = tmp_path / "weekly.log"
    old = tmp_path / "weekly.log.1"
    old.write_text("older evidence")
    for _ in range(2):
        with log.open("wb") as stream:
            stream.truncate(20_000_001)
        result = subprocess.run(["cmd.exe", "/d", "/c", str(script)],
                                env={**os.environ, "LOG": str(log), "UNPROMPTED_PYTHON": sys.executable},
                                capture_output=True, timeout=20)
        assert result.returncode == 0
        assert not log.exists()
    assert len(list(tmp_path.glob("weekly-*.log"))) == 2
    assert old.read_text() == "older evidence"

@pytest.mark.parametrize("sources", [{"data": []}, {"data": {"file": {"sha": "a" * 64, "size": -1}}}])
def test_malformed_manifest_is_reported(fixture, sources):
    _, _, dest = fixture
    assert b.main(["--dest", str(dest)]) == 0
    path = max((dest / "snapshots").glob("*.json"), key=lambda p: p.stat().st_mtime_ns)
    manifest = json.loads(path.read_text())
    manifest["sources"] = sources
    path.write_text(json.dumps(manifest))
    assert b.main(["--restore-check", "--dest", str(dest)]) == 1
