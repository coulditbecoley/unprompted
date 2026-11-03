"""Run the real Windows launcher against a disposable local Git remote."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(sys.platform != "win32", reason="executes the actual Windows cmd launcher")
def test_weekly_launcher_publishes_and_guards_without_paid_calls(tmp_path):
    repo = tmp_path / "coley's repo with spaces"
    remote = tmp_path / "remote.git"
    repo.mkdir()
    env = {**os.environ, "TEMP": str(tmp_path / "temp with spaces"), "TMP": str(tmp_path / "temp with spaces")}
    Path(env["TEMP"]).mkdir()
    def git(*args):
        return subprocess.run(["git", *args], cwd=repo, env=env, text=True,
                              capture_output=True, check=True).stdout.strip()
    git("init", "--bare", str(remote))
    git("init", "-b", "main")
    git("config", "user.name", "Offline test")
    git("config", "user.email", "test@example.invalid")
    git("remote", "add", "origin", str(remote))
    (repo / "scripts").mkdir()
    (repo / "data").mkdir()
    (repo / "reports").mkdir()
    (repo / "unprompted").mkdir()
    (repo / "unprompted/__init__.py").write_text("")
    (repo / ".gitignore").write_text(".venv/\n.unprompted/\n__pycache__/\n")
    shutil.copyfile(ROOT / "scripts/weekly-run.cmd", repo / "scripts/weekly-run.cmd")
    shutil.copyfile(ROOT / "scripts/timed.py", repo / "scripts/timed.py")
    # The real publisher, with the one stdlib module it needs.
    shutil.copyfile(ROOT / "scripts/publish.py", repo / "scripts/publish.py")
    (repo / "src/unprompted").mkdir(parents=True)
    (repo / "src/unprompted/__init__.py").write_text("")
    shutil.copyfile(ROOT / "src/unprompted/storage.py", repo / "src/unprompted/storage.py")
    # All external work is replaced in the disposable checkout only.
    (repo / "unprompted/run.py").write_text(
        "from pathlib import Path\nimport os\n"
        "p=Path('.unprompted/invocations');p.parent.mkdir(exist_ok=True)\n"
        "p.write_text(p.read_text()+'run\\n' if p.exists() else 'run\\n')\n"
        "Path('data/test.json').write_text('{}')\n"
        "raise SystemExit(int(os.environ.get('TEST_PIPELINE_EXIT','0')))\n")
    (repo / "scripts/notify.py").write_text(
        "from pathlib import Path\nimport sys\n"
        "status=sys.argv[sys.argv.index('--status')+1]\n"
        "p=Path('.unprompted/attempt.json') if status=='failed' else Path('data/last-run.json')\n"
        "p.parent.mkdir(exist_ok=True);p.write_text(status)\n")
    for name in ("sync_vault.py", "sync_analytics.py"):
        (repo / "scripts" / name).write_text("# Offline no-op\n")
    # Heartbeat: records each call instead of setting a GitHub variable.
    (repo / "scripts/heartbeat.py").write_text(
        "from pathlib import Path\nimport sys\n"
        "p=Path('.unprompted/heartbeats');p.parent.mkdir(exist_ok=True)\n"
        "p.write_text((p.read_text() if p.exists() else '')+' '.join(sys.argv[1:])+'\\n')\n")
    # The shadow Jev step: records that it ran, then fails, to prove a failure changes nothing.
    (repo / "scripts/compare_jev.py").write_text(
        "from pathlib import Path\n"
        "p=Path('.unprompted/jev-hook');p.parent.mkdir(exist_ok=True)\n"
        "p.write_text(p.read_text()+'jev\\n' if p.exists() else 'jev\\n')\n"
        "raise SystemExit(1)\n")
    venv.EnvBuilder(with_pip=False).create(repo / ".venv")
    git("add", ".")
    git("commit", "-m", "offline setup")
    git("push", "-u", "origin", "main")
    def launch(expected):
        result = subprocess.run(["cmd.exe", "/d", "/c", "scripts\\weekly-run.cmd"],
                                cwd=repo, env=env, capture_output=True, text=True, timeout=60)
        log = (repo / ".unprompted/logs/weekly.log").read_text(errors="replace")
        assert result.returncode == expected, result.stdout + result.stderr + log
    launch(0)
    assert git("status", "--porcelain") == ""
    assert git("rev-parse", "HEAD") == git("ls-remote", "origin", "refs/heads/main").split()[0]
    invocations = repo / ".unprompted/invocations"
    assert invocations.read_text() == "run\n"
    assert (repo / ".unprompted/jev-hook").read_text() == "jev\n"      # ran after publishing; its failure changed nothing
    assert (repo / ".unprompted/weekly-started").exists()               # the start marker the budget uses
    assert (repo / ".unprompted/heartbeats").read_text() == "started\nfinished --exit-code 0\n"
    (repo / "staged.txt").write_text("operator work")
    git("add", "staged.txt")
    attempt = repo / ".unprompted/attempt.json"
    attempt.unlink(missing_ok=True)
    launch(1)
    assert invocations.read_text() == "run\n"
    assert attempt.read_text() == "failed"  # staged work used to stop the week silently
    git("reset", "--", "staged.txt")
    (repo / "staged.txt").unlink()
    (repo / "data/test.json").write_text("uncommitted data")
    launch(1)
    assert invocations.read_text() == "run\n"
    git("restore", "data/test.json")
    (repo / "scripts/sync_vault.py").write_text("# Uncommitted launcher dependency\n")
    launch(1)
    assert invocations.read_text() == "run\n"
    git("restore", "scripts/sync_vault.py")
    git("switch", "-c", "feature")
    attempt.unlink()
    launch(1)
    assert invocations.read_text() == "run\n"
    assert attempt.read_text() == "failed"  # so did a checkout left on another branch
    git("switch", "main")
    # Fetch remains valid while the push endpoint is unavailable: no paid calls.
    git("config", "remote.origin.pushurl", str(tmp_path / "unavailable.git"))
    launch(1)
    assert invocations.read_text() == "run\n"
    assert (repo / ".unprompted/attempt.json").read_text() == "failed"
    git("config", "--unset", "remote.origin.pushurl")
    env["TEST_PIPELINE_EXIT"] = "2"
    launch(2)
    assert invocations.read_text() == "run\nrun\n"
    assert git("status", "--porcelain") == ""
    assert git("rev-parse", "HEAD") == git("ls-remote", "origin", "refs/heads/main").split()[0]
    assert (repo / ".unprompted/jev-hook").read_text() == "jev\njev\n"

    # No .venv: no Python, so no notify.py. gh still opens the issue directly.
    bin_dir = tmp_path / "fake bin"
    bin_dir.mkdir()
    (bin_dir / "gh.cmd").write_text('@echo %* > "%TEMP%\\gh-called.txt"\n')
    env["PATH"] = f"{bin_dir};{env['PATH']}"
    (repo / ".venv").rename(repo / ".venv-away")
    result = subprocess.run(["cmd.exe", "/d", "/c", "scripts\\weekly-run.cmd"],
                            cwd=repo, env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 1
    called = (Path(env["TEMP"]) / "gh-called.txt").read_text()
    assert "issue create" in called and "Weekly run FAILED" in called and "--body-file" in called
    assert "missing" in (Path(env["TEMP"]) / "unprompted-alert.txt").read_text()
    assert invocations.read_text() == "run\nrun\n"  # nothing measured


def test_watchdog_requires_this_weeks_measurement_not_a_reread(tmp_path, monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location("watchdog_audit", ROOT / "scripts/watchdog.py")
    wd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wd)
    from datetime import date, datetime
    for timestamp, expected in [
        ("2026-09-14T22:00:00+00:00", date(2026, 9, 7)),
        ("2026-09-15T01:59:59+00:00", date(2026, 9, 7)),
        ("2026-09-15T02:00:00+00:00", date(2026, 9, 14)),
        ("2026-11-03T01:59:59+00:00", date(2026, 10, 26)),
        ("2026-11-03T02:00:00+00:00", date(2026, 11, 2)),
    ]:
        instant = datetime.fromisoformat(timestamp)
        assert wd.most_recent_monday(instant.date(), instant) == expected
    questions = tmp_path / "questions"
    questions.mkdir()
    (questions / "alpha.yml").write_text("questions: []")
    monkeypatch.setattr(wd, "QUESTIONS", questions)
    monkeypatch.setattr(wd, "RUNS", tmp_path / "runs")
    monkeypatch.setattr(wd, "HELD", tmp_path / "held")
    path = wd.RUNS / "2026-09-15/alpha.json"
    path.parent.mkdir(parents=True)
    record = {"category": "alpha", "run_date": "2026-09-15", "measured_on": "2026-09-07",
              "source_run": "2026-09-07/alpha", "extractions": [{"engine": "test"}]}
    path.write_text(json.dumps(record))
    assert wd.week_status(date(2026, 9, 14))[1] == ["alpha"]
    record["measured_on"] = "2026-09-15"
    path.write_text(json.dumps(record))
    assert wd.week_status(date(2026, 9, 14))[0] == ["alpha"]
    path.write_text("{broken")
    assert wd.week_status(date(2026, 9, 14))[1] == ["alpha"]
    calls = []
    def gh(args, **kwargs):
        assert "--label" not in args  # An absent repository label must not suppress the alarm.
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout="[]")
    monkeypatch.setattr(wd.subprocess, "run", gh)
    wd.open_issue("Missing week", "Offline test")
    assert [args[2] for args in calls] == ["list", "create"]


@pytest.mark.skipif(sys.platform != "win32", reason="runs the real Task Scheduler installer in dry-run mode")
def test_installer_registers_readiness_with_its_own_budget_and_refuses_a_bad_one(tmp_path):
    sys.path.insert(0, str(ROOT))
    from scripts import readiness

    def install(python):
        return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                               str(ROOT / "scripts" / "install-weekly-task.ps1"), "-DryRun", "-Python", str(python)],
                              capture_output=True, text=True, timeout=180)

    done = install(sys.executable)
    assert done.returncode == 0, done.stderr
    settings = json.loads(done.stdout.strip().splitlines()[-1])
    # Windows must never end the check before its own retries, cleanup and issue can finish.
    assert settings["readiness_limit_seconds"] == readiness.task_limit_seconds()
    assert settings["readiness_limit_seconds"] > readiness.LIMIT_SECONDS + readiness.WRAPPER_GRACE_SECONDS
    assert settings["weekly_limit_seconds"] == 8 * 3600
    assert settings["weekly_start"].endswith("T13:00:00") and settings["readiness_start"].endswith("T18:00:00")
    assert settings["midweek_start"].endswith("T09:00:00") and settings["midweek_limit_seconds"] == 1800
    source = (ROOT / "scripts" / "install-weekly-task.ps1").read_text()
    assert '"scripts\\readiness.py --free"' in source  # a stray \r once turned this path into "scripts<CR>eadiness"

    garbage = tmp_path / "python.cmd"
    garbage.write_text("@echo not-a-number\n")
    refused = install(garbage)
    assert refused.returncode != 0 and "nothing registered" in refused.stderr + refused.stdout


def _watchdog():
    sys.path.insert(0, str(ROOT))
    from scripts import watchdog
    return watchdog


@pytest.mark.parametrize("utc, mode, due", [
    ("2026-11-09T19:17:00", "start", True),    # winter: 14:17 New York, past the 14:15 gate
    ("2026-11-09T18:17:00", "start", False),   # 13:17 New York: too early, the next slot looks
    ("2026-07-13T18:17:00", "start", True),    # summer: 14:17 New York
    ("2026-11-10T02:43:00", "finish", True),   # Monday 21:43 New York, Tuesday in UTC
    ("2026-11-10T01:43:00", "finish", False),  # 20:43 New York
    ("2026-07-14T01:43:00", "finish", True),   # summer: 21:43 New York
])
def test_heartbeat_checks_follow_new_york_time_across_dst(utc, mode, due):
    from datetime import datetime, timezone
    wd = _watchdog()
    now = datetime.fromisoformat(utc).replace(tzinfo=timezone.utc)
    alarm = wd.heartbeat_alarm(mode, "", now)
    assert (alarm is not None) == due


def test_heartbeat_checks_judge_this_weeks_beat_only():
    from datetime import datetime, timezone
    wd = _watchdog()
    late = datetime(2026, 11, 10, 2, 43, tzinfo=timezone.utc)  # Monday 2026-11-09, 21:43 New York
    beat = lambda **kw: json.dumps({"week": "2026-11-09", "phase": "started", **kw})
    assert wd.heartbeat_alarm("start", beat(), late) is None
    assert "has not finished" in wd.heartbeat_alarm("finish", beat(), late)[0]
    assert wd.heartbeat_alarm("finish", beat(phase="finished", exit_code=2), late) is None
    last_week = json.dumps({"week": "2026-11-02", "phase": "finished"})
    title, body = wd.heartbeat_alarm("start", last_week, late)
    assert title == "Weekly run has not started: 2026-11-09" and "2026-11-02" in body
    for junk in ("not json", "[]", '{"week": 5}'):
        assert wd.heartbeat_alarm("start", junk, late) is not None  # unknown is not healthy


def test_the_site_check_names_a_category_the_live_site_has_not_caught_up_on(tmp_path, monkeypatch):
    import io
    wd = _watchdog()
    runs = tmp_path / "runs"
    for day in ("2026-11-02", "2026-11-09"):
        (runs / day).mkdir(parents=True)
        (runs / day / "alpha.json").write_text("{}")
    (runs / "2026-11-09" / "beta.json").write_text("{}")
    monkeypatch.setattr(wd, "RUNS", runs)
    served = {"alpha": "2026-11-02", "beta": "2026-11-09"}
    class Reply(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False
    def fake(url, timeout):
        return Reply(json.dumps({"reading": served[url.rsplit("/", 1)[1][:-5]]}).encode())
    monkeypatch.setattr(wd.urllib.request, "urlopen", fake)
    lines = wd.stale_site(["alpha", "beta"])
    assert len(lines) == 1 and "`alpha`" in lines[0] and "2026-11-09" in lines[0]


def test_new_york_time_matches_the_us_dst_rule():
    from datetime import datetime, timezone
    wd = _watchdog()
    utc = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    assert wd.new_york(utc("2026-03-08T06:59:00")).hour == 1   # 01:59 EST, just before the switch
    assert wd.new_york(utc("2026-03-08T07:00:00")).hour == 3   # 03:00 EDT
    assert wd.new_york(utc("2026-11-01T05:59:00")).hour == 1   # 01:59 EDT
    assert wd.new_york(utc("2026-11-01T06:00:00")).hour == 1   # 01:00 EST again
    assert wd.new_york(utc("2027-03-14T12:00:00")).hour == 8   # second Sunday of March 2027
