"""scripts/publish.py against real disposable Git repositories and a bare remote. Offline."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import publish  # noqa: E402
from unprompted.storage import run_lock  # noqa: E402


def run(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


@pytest.fixture
def repo(tmp_path, monkeypatch):
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    run(tmp_path, "init", "--bare", "-b", "main", str(remote))
    run(tmp_path, "clone", str(remote), str(work))
    for key, value in (("user.name", "t"), ("user.email", "t@example.invalid")):
        run(work, "config", key, value)
    (work / "data").mkdir()
    (work / "reports").mkdir()
    (work / "data/a.json").write_text("{}")
    (work / ".gitignore").write_text(".unprompted/\n")
    run(work, "add", ".")
    run(work, "commit", "-m", "start")
    run(work, "push", "-u", "origin", "main")
    monkeypatch.setattr(publish, "REPO", work)
    monkeypatch.setattr(publish, "STATE", work / ".unprompted")
    monkeypatch.setattr(publish, "INTENT", work / ".unprompted/publish-intent.json")
    monkeypatch.setattr(publish, "BACKOFF", (0, 0))
    monkeypatch.setattr(publish.time, "sleep", lambda s: None)
    return work, remote


def remote_head(remote):
    return run(remote, "rev-parse", "main")


def measure(work, text="{\"week\": 1}"):
    (work / "data/a.json").write_text(text)


def test_a_measured_week_is_committed_pushed_and_recorded(repo):
    work, remote = repo
    measure(work)
    code, why = publish.final("Run: measured and published")
    assert code == 0 and why.startswith("PUSHED")
    head = run(work, "rev-parse", "HEAD")
    assert remote_head(remote) == head
    assert json.loads(publish.INTENT.read_text())["state"] == "pushed"
    assert run(work, "log", "-1", "--format=%an %s") == "unprompted-bot Run: measured and published"


def test_a_failed_push_is_finished_by_the_next_start(repo):
    work, remote = repo
    run(work, "config", "remote.origin.pushurl", str(work.parent / "missing.git"))
    measure(work)
    code, why = publish.final("Run: measured and published")
    assert code == 3 and "push failed" in why and "Do not re-run" in why
    intent = json.loads(publish.INTENT.read_text())
    assert intent["state"] == "committed" and remote_head(remote) != intent["commit"]
    run(work, "config", "--unset", "remote.origin.pushurl")  # the network is back
    assert publish.finish_pending() == (0, f"pushed {intent['commit'][:12]}")
    assert remote_head(remote) == intent["commit"]
    assert publish.finish_pending() == (0, "nothing pending")  # idempotent


def test_a_push_whose_acknowledgement_was_lost_is_not_pushed_again(repo):
    work, remote = repo
    run(work, "config", "remote.origin.pushurl", str(work.parent / "missing.git"))
    measure(work)
    publish.final("Run: x")
    run(work, "config", "--unset", "remote.origin.pushurl")
    run(work, "push", "origin", "main")  # it landed after all, then the remote moved on
    other = work.parent / "other"
    run(work.parent, "clone", str(remote), str(other))
    (other / "data/b.json").write_text("{}")
    run(other, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "x", "--allow-empty")
    run(other, "push", "origin", "main")
    code, why = publish.finish_pending()
    assert code == 0 and "already on origin" in why


def test_divergence_moved_head_and_unclaimed_commits_are_left_for_a_person(repo):
    work, remote = repo
    run(work, "config", "remote.origin.pushurl", str(work.parent / "missing.git"))
    measure(work)
    publish.final("Run: x")
    run(work, "config", "--unset", "remote.origin.pushurl")
    # HEAD moved past the recorded week.
    (work / "notes.txt").write_text("hand edit")
    run(work, "add", "notes.txt")
    run(work, "commit", "-m", "hand commit")
    code, why = publish.finish_pending()
    assert code == 3 and "moved away" in why
    run(work, "reset", "--hard", "HEAD~1")
    # Someone else published meanwhile: diverged.
    other = work.parent / "other"
    run(work.parent, "clone", str(remote), str(other))
    run(other, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "elsewhere", "--allow-empty")
    run(other, "push", "origin", "main")
    before = remote_head(remote)
    code, why = publish.finish_pending()
    assert code == 3 and "diverged" in why and remote_head(remote) == before  # never forced
    # A commit no intent claims never rides along with a new week.
    publish.INTENT.unlink()
    run(work, "fetch", "origin")
    measure(work, '{"week": 2}')
    code, why = publish.final("Run: y")
    assert code == 3 and "not on origin that no run recorded" in why


def test_a_damaged_intent_and_a_busy_lock_stop_safely(repo, monkeypatch, capsys):
    work, _ = repo
    publish.INTENT.parent.mkdir(parents=True, exist_ok=True)
    publish.INTENT.write_text('{"state": "committed", "commit": "nope"}')
    with pytest.raises(RuntimeError, match="malformed"):
        publish.finish_pending()
    monkeypatch.setattr(sys, "argv", ["publish.py", "pending"])
    assert publish.main() == 3
    with run_lock(publish.STATE, "week.lock"):
        assert publish.main() == 4
