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
    (other / "data/a.json").write_text('{"edited": "elsewhere"}')
    run(other, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qam", "elsewhere")
    run(other, "push", "origin", "main")
    before = remote_head(remote)
    code, why = publish.finish_pending()
    assert code == 3 and "diverged" in why and "changed data/" in why and remote_head(remote) == before  # never forced
    # A commit no intent claims never rides along with a new week.
    publish.INTENT.unlink()
    run(work, "fetch", "origin")
    measure(work, '{"week": 2}')
    code, why = publish.final("Run: y")
    assert code == 3 and "not on origin that no run recorded" in why


def test_check_names_unclaimed_commits_before_paid_work_and_records_nothing(repo, monkeypatch):
    work, remote = repo
    monkeypatch.setattr(sys, "argv", ["publish.py", "check"])
    assert publish.main() == 0
    (work / "notes.txt").write_text("agent work")
    run(work, "add", "notes.txt")
    run(work, "commit", "-m", "local only")
    assert "1 commit(s) not on origin" in publish.unclaimed(fetch=True)
    assert publish.main() == 3
    assert not (publish.STATE / "status" / "publish.json").exists()  # a check is not a publication
    run(work, "push", "origin", "main")
    assert publish.unclaimed(fetch=True) == ""
    run(work, "config", "remote.origin.url", str(work.parent / "missing.git"))
    assert "could not fetch origin" in publish.unclaimed(fetch=True)


def _week_unpushed_while_origin_moves(work, remote, files):
    """A week committed but not pushed, while someone else lands `files` on origin."""
    run(work, "config", "remote.origin.pushurl", str(work.parent / "missing.git"))
    measure(work)
    code, why = publish.final("Run: measured and published")
    assert code == 3 and "Do not re-run" in why
    run(work, "config", "--unset", "remote.origin.pushurl")
    other = work.parent / "other"
    run(work.parent, "clone", str(remote), str(other))
    for name, text in files.items():
        (other / name).parent.mkdir(parents=True, exist_ok=True)
        (other / name).write_text(text)
    run(other, "add", ".")
    run(other, "-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "merged PR")
    run(other, "push", "origin", "main")
    return json.loads(publish.INTENT.read_text()), remote_head(remote)


def test_a_week_is_replayed_onto_code_merged_during_the_run(repo):
    work, remote = repo
    intent, merged = _week_unpushed_while_origin_moves(work, remote, {"src/new.py": "x = 1\n"})
    code, why = publish.finish_pending()
    assert code == 0 and "replayed from" in why, why
    head = run(work, "rev-parse", "HEAD")
    assert remote_head(remote) == head and head != intent["commit"]
    assert run(work, "rev-parse", "HEAD~1") == merged                     # on top, nothing forced
    assert run(work, "show", "HEAD:data/a.json") == '{"week": 1}'         # the measured week, unchanged
    assert (work / "src/new.py").exists()
    assert run(work, "log", "-1", "--format=%an %s") == "unprompted-bot Run: measured and published"
    assert run(work, "status", "--porcelain") == ""
    saved = json.loads(publish.INTENT.read_text())
    assert saved == {**intent, "commit": head, "parent": merged, "replayed_from": intent["commit"], "state": "pushed"}
    assert publish.finish_pending() == (0, "nothing pending")


def test_a_replay_is_refused_off_main_or_when_the_week_touched_more_than_data(repo):
    work, remote = repo
    intent, merged = _week_unpushed_while_origin_moves(work, remote, {"src/new.py": "x = 1\n"})
    run(work, "switch", "-qc", "feature")
    code, why = publish.finish_pending()
    assert code == 3 and "not on main" in why and remote_head(remote) == merged
    run(work, "switch", "-q", "main")
    # A week commit that also carried a code change is never replayed automatically.
    (work / "src").mkdir(exist_ok=True)
    (work / "src/hand.py").write_text("y = 2\n")
    run(work, "add", "src/hand.py")
    run(work, "commit", "-q", "--amend", "--no-edit")
    publish.write_json(publish.INTENT, {**intent, "commit": run(work, "rev-parse", "HEAD")}, replace=True)
    code, why = publish.finish_pending()
    assert code == 3 and "outside data/" in why and remote_head(remote) == merged


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


def test_a_held_week_issue_names_the_alias_file_and_the_free_command(tmp_path, monkeypatch):
    from scripts import notify
    monkeypatch.setattr(notify, "REPO", tmp_path)
    held = tmp_path / "data/held/2026-11-02"
    held.mkdir(parents=True)
    (held / "ai-writing-tools.json").write_text(json.dumps({"extractions": [{"extracted": []}, {"extracted": [{"brand": "X"}]}]}))
    (held / "ai-image-generators.json").write_text(json.dumps({"extractions": [{"extracted": None}]}))
    summary = {"run_date": "2026-11-02", "categories": {
        "ai-writing-tools": {"outcome": "held", "reasons": ["3 unrecognised brand name(s) appeared in at least 2% of runs and need a decision: GitBook, DeepL Write"]},
        "ai-image-generators": {"outcome": "held", "reasons": ["1 unrecognised brand name(s) appeared in at least 2% of runs and need a decision: Getty", "perplexity failed 75 of its own 75 calls"]},
        "ai-coding-assistants": {"outcome": "held", "reasons": ["perplexity failed 75 of its own 75 calls"]},
    }}
    text = "\n".join(notify.alias_steps(summary))
    assert "`aliases/ai-writing-tools.yml`" in text and "GitBook, DeepL Write" in text
    assert "reextract 2026-11-02 --category ai-writing-tools --renormalize" in text
    assert "--category ai-image-generators --renormalize" not in text and "paid re-read" in text  # no raw names stored
    assert "Also held for: perplexity" in text
    assert "ai-coding-assistants" not in text  # held for something else entirely
    assert notify.alias_steps(None) == [] and notify.alias_steps({"categories": {}}) == []
