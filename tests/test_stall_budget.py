"""Offline process and scheduler contracts; no provider calls."""
import ast
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

from unprompted import cli_provider as cli


def provider():
    return cli.CliProvider("claude-code", "Claude", "claude", cli.ALLOWED_CLIS["claude"])


@pytest.mark.skipif(os.name != "nt", reason="Windows taskkill contract")
@pytest.mark.parametrize("code", [128, 1, 5])
def test_taskkill_accepts_only_already_exited(monkeypatch, code):
    def kill(argv, **kwargs):
        assert kwargs["timeout"] == cli.TREE_KILL_SECONDS
        raise subprocess.CalledProcessError(code, argv)
    monkeypatch.setattr(cli.subprocess, "run", kill)
    if code == 128:
        cli._end_tree(123)
    else:
        with pytest.raises(subprocess.CalledProcessError):
            cli._end_tree(123)


def test_slow_successful_cleanup_remains_a_retryable_timeout(monkeypatch, tmp_path):
    waits = []
    class Child:
        pid = 123
        def communicate(self, *args, timeout):
            waits.append(timeout)
            if args or timeout < 90:
                raise subprocess.TimeoutExpired("offline", timeout)
            return "partial", ""
    monkeypatch.setattr(cli.CliProvider, "resolve", lambda self: "offline")
    monkeypatch.setattr(cli.subprocess, "Popen", lambda *a, **k: Child())
    monkeypatch.setattr(cli, "_end_tree", lambda pid: None)
    with pytest.raises(cli.CliTimeout) as caught:
        provider()._exec("probe", str(tmp_path))
    assert caught.value.stdout == "partial"
    assert waits[-1] == cli.CLEANUP_WAIT_SECONDS >= 90


@pytest.mark.skipif(os.name != "nt", reason="Windows taskkill contract")
def test_timed_tolerates_an_already_exited_child_and_allows_slow_reaping(monkeypatch):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts import timed
    waits = []
    class Child:
        pid = 123
        def wait(self, timeout):
            waits.append(timeout)
            if timeout < 90:
                raise subprocess.TimeoutExpired("offline", timeout)
            return 0
    def kill(argv, **kwargs):
        assert kwargs["timeout"] == cli.TREE_KILL_SECONDS
        raise subprocess.CalledProcessError(128, argv)
    monkeypatch.setattr(timed.subprocess, "Popen", lambda *a, **k: Child())
    monkeypatch.setattr(timed.subprocess, "run", kill)
    assert timed.run(1, ["offline"]) == 124
    assert waits == [1, cli.CLEANUP_WAIT_SECONDS]


@pytest.mark.parametrize("timeouts", [0, 2, 3])
def test_version_uses_timeout_only_probe_retries(monkeypatch, timeouts):
    calls, pauses = [], []
    def execute(self, prompt, cwd, extra=(), *, version=False):
        calls.append(version)
        if version and len(calls) <= timeouts:
            raise cli.CliTimeout("version stalled")
        return SimpleNamespace(returncode=0, stdout="1.2.3\n" if version else
                               '{"modelUsage":{"pinned-model":{"outputTokens":1}}}', stderr="")
    monkeypatch.setattr(cli.CliProvider, "_exec", execute)
    monkeypatch.setattr(cli.time, "sleep", pauses.append)
    if timeouts == cli.PROBE_ATTEMPTS:
        with pytest.raises(cli.CliTimeout):
            provider().identify()
        assert calls == [True] * cli.PROBE_ATTEMPTS
    else:
        assert provider().identify() == {"model": "pinned-model", "version": "1.2.3"}
        assert calls == [True] * (timeouts + 1) + [False]
    assert pauses == [cli.PROBE_PAUSE_SECONDS] * min(timeouts, cli.PROBE_ATTEMPTS - 1)


def test_version_real_failure_is_not_retried(monkeypatch):
    calls = []
    def execute(self, *a, **k):
        calls.append(k)
        return SimpleNamespace(returncode=1, stdout="", stderr="bad installation")
    monkeypatch.setattr(cli.CliProvider, "_exec", execute)
    with pytest.raises(cli.ProviderError, match="version check failed.*bad installation"):
        provider().identify()
    assert calls == [{"version": True}]


def test_version_keeps_its_argv_and_uses_the_shared_deadline(monkeypatch, tmp_path):
    calls = []
    class Child:
        returncode = 0
        def communicate(self, prompt, timeout):
            assert prompt == "" and timeout == cli.TIMEOUT_SECONDS
            return "1.2.3", ""
    monkeypatch.setattr(cli.CliProvider, "resolve", lambda self: "offline")
    monkeypatch.setattr(cli.subprocess, "Popen", lambda argv, **kw: (calls.append((argv, kw)) or Child()))
    provider()._exec("", str(tmp_path), version=True)
    assert calls[0][0] == ["offline", "--version"]
    assert calls[0][1]["cwd"] == str(tmp_path)


def test_readiness_budget_covers_probes_cleanup_and_lock_wait(monkeypatch):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts import readiness
    monkeypatch.setattr(cli, "declared_clis", lambda role: [object(), object()])
    expected = 2 * 3 * (cli.PROBE_ATTEMPTS * (cli.TIMEOUT_SECONDS + cli.TREE_KILL_SECONDS + cli.CLEANUP_WAIT_SECONDS)
                        + (cli.PROBE_ATTEMPTS - 1) * cli.PROBE_PAUSE_SECONDS) + 300
    assert cli.readiness_limit_seconds() == expected
    monkeypatch.setattr(readiness, "LIMIT_SECONDS", expected)
    start = datetime(2026, 11, 2, 13)
    cutoff = start - timedelta(seconds=expected + readiness.WRAPPER_GRACE_SECONDS)
    assert readiness.target_monday(cutoff - timedelta(microseconds=1)) == start.date()
    assert readiness.target_monday(cutoff) is None
    source = Path(cli.__file__).with_name("run.py").read_text(encoding="utf-8")
    waits = [k.value for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name) and n.func.id == "run_lock" for k in n.keywords if k.arg == "wait"]
    assert len(waits) == 1
    wait = eval(compile(ast.Expression(waits[0]), "lock wait", "eval"))
    assert wait > expected + readiness.WRAPPER_GRACE_SECONDS
