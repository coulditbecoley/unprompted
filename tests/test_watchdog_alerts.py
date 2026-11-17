"""Watchdog scheduling and alert lifecycle, with no real GitHub calls."""
from pathlib import Path
import sys

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts import watchdog as wd


def test_start_schedule_has_redundant_slots_and_dispatches_to_start():
    text = (Path(__file__).resolve().parents[1] / '.github/workflows/watchdog.yml').read_text()
    workflow = yaml.load(text, Loader=yaml.BaseLoader)
    schedule = '17,47 18,19,20 * * 1'
    assert {'cron': schedule} in workflow['on']['schedule']
    shell = workflow['jobs']['check']['steps'][-1]['run']
    assert f'"{schedule}") args+=(--mode start)' in shell
    assert workflow['jobs']['check']['timeout-minutes'] == '10'
    assert workflow['concurrency']['cancel-in-progress'] == 'true'

import json
import subprocess
from datetime import date
from types import SimpleNamespace

import pytest


@pytest.fixture(autouse=True)
def no_external_calls(monkeypatch):
    monkeypatch.setattr(wd.subprocess, 'run', lambda *a, **k: pytest.fail('unmocked GitHub call'))
    monkeypatch.setattr(wd.urllib.request, 'urlopen', lambda *a, **k: pytest.fail('unmocked network call'))


def archive(monkeypatch, tmp_path):
    monkeypatch.setattr(wd, 'RUNS', tmp_path / 'runs')
    monkeypatch.setattr(wd, 'HELD', tmp_path / 'held')
    monkeypatch.setattr(wd, 'STATUS_FILE', tmp_path / 'status.json')
    monkeypatch.setattr(wd, 'live_categories', lambda: ['alpha'])


def reading(base, day, category='alpha', measured_on=None):
    path = base / day / f'{category}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'category': category, 'run_date': day,
                               'measured_on': measured_on or day, 'extractions': [{'engine': 'offline'}]}))


def github(monkeypatch, issues):
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        if args[1] == 'api':
            assert '--paginate' in args and '--slurp' in args
            return SimpleNamespace(stdout=json.dumps([issues[:2], issues[2:]]))
        if args[1:3] == ['issue', 'list']:
            return SimpleNamespace(stdout=json.dumps(issues))
        assert args[1:3] in (['issue', 'close'], ['issue', 'create'])
        return SimpleNamespace(stdout='ok')
    monkeypatch.setattr(wd.subprocess, 'run', run)
    return calls


def test_cleanup_only_our_resolved_alerts_and_keeps_held_decisions(monkeypatch, tmp_path):
    archive(monkeypatch, tmp_path)
    reading(wd.HELD, '2026-11-02')
    reading(wd.RUNS, '2026-11-16')  # a later reading does not resolve the old held reading
    titles = ['Weekly run FAILED: 2026-11-02', 'Weekly run has not started: 2026-11-16',
              'Weekly run held for review: 2026-11-02', 'Weekly run held, not published: 2026-11-02',
              'Weekly run FAILED: 2026-11-23', 'Unrelated: 2026-11-02',
              'Weekly run FAILED: 2026-11-02 extra', 'Site is not serving the latest week: 2026-11-02',
              'Weekly run held for review: 2026-10-26']
    issues = [{'number': i, 'title': title} for i, title in enumerate(titles, 1)]
    issues.append({'number': 10, 'title': titles[0], 'pull_request': {}})
    calls = github(monkeypatch, issues)
    assert wd.close_resolved_issues(date(2026, 11, 16), site_current=False)
    closed = [a for a in calls if a[1:3] == ['issue', 'close']]
    assert [a[3] for a in closed] == ['1', '2']
    assert all('--comment' in a for a in closed)
    assert 'supersedes' in closed[0][-1]
    reading(wd.RUNS, '2026-11-17', measured_on='2026-11-02')
    calls.clear()
    assert wd.close_resolved_issues(date(2026, 11, 16), site_current=True)
    assert [a[3] for a in calls if a[1:3] == ['issue', 'close']] == ['1', '2', '3', '4', '8']


@pytest.mark.parametrize('prefix', ['has not started', 'has not finished', 'did not happen', 'incomplete', 'held, not published'])
def test_failure_issue_suppresses_same_week_watchdog_alarms(monkeypatch, prefix):
    calls = github(monkeypatch, [{'title': 'Weekly run FAILED: 2026-11-16'}])
    wd.open_issue(f'Weekly run {prefix}: 2026-11-16', 'offline')
    assert not any(a[1:3] == ['issue', 'create'] for a in calls)


def test_issue_dedup_is_exact_and_other_week_failure_does_not_suppress(monkeypatch):
    title = 'Weekly run has not started: 2026-11-16'
    calls = github(monkeypatch, [{'title': 'Weekly run FAILED: 2026-11-09'}, {'title': title + ' extra'}])
    wd.open_issue(title, 'offline')
    assert sum(a[1:3] == ['issue', 'create'] for a in calls) == 1
    calls = github(monkeypatch, [{'title': title}])
    wd.open_issue(title, 'offline')
    assert not any(a[1:3] == ['issue', 'create'] for a in calls)


def test_clean_archive_runs_cleanup_only_with_issue_flag(monkeypatch, tmp_path):
    archive(monkeypatch, tmp_path)
    reading(wd.RUNS, '2026-11-16')
    monkeypatch.setattr(sys, 'argv', ['watchdog', '--date', '2026-11-17'])
    assert wd.main() == 0
    calls = github(monkeypatch, [{'number': 1, 'title': 'Weekly run FAILED: 2026-11-09'}])
    monkeypatch.setattr(sys, 'argv', ['watchdog', '--date', '2026-11-17', '--issue'])
    assert wd.main() == 0
    assert any(a[1:3] == ['issue', 'close'] for a in calls)


def test_cleanup_failure_is_reported_and_unverifiable_site_is_not_healthy(monkeypatch, tmp_path):
    archive(monkeypatch, tmp_path)
    reading(wd.RUNS, '2026-11-16')
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, 'gh')
    monkeypatch.setattr(wd.subprocess, 'run', fail)
    assert wd.close_resolved_issues(date(2026, 11, 16), site_current=True) is False
    monkeypatch.setattr(sys, 'argv', ['watchdog', '--date', '2026-11-17', '--issue'])
    assert wd.main() == 1
    def offline(*args, **kwargs):
        raise OSError('offline')
    monkeypatch.setattr(wd.urllib.request, 'urlopen', offline)
    assert 'could not be verified' in wd.stale_site(['alpha'])[0]


@pytest.mark.parametrize('mode', ['start', 'finish', 'missing', 'held', 'stale'])
@pytest.mark.parametrize('delivered', [True, False])
def test_issue_mode_exit_tracks_delivery_not_measurement(monkeypatch, tmp_path, mode, delivered):
    archive(monkeypatch, tmp_path)
    args = ['watchdog', '--issue']
    if mode in ('start', 'finish'):
        args += ['--mode', mode]
        monkeypatch.setattr(wd, 'heartbeat_alarm', lambda *a: ('alarm', 'offline'))
    else:
        args += ['--date', '2026-11-17']
        if mode == 'held':
            reading(wd.HELD, '2026-11-16')
        elif mode == 'missing':
            reading(wd.RUNS, '2026-11-09')
        else:
            reading(wd.RUNS, '2026-11-16')
            args = ['watchdog', '--issue']
            monkeypatch.setattr(wd, 'most_recent_monday', lambda *a: date(2026, 11, 16))
            monkeypatch.setattr(wd, 'stale_site', lambda *a: ['offline stale reading'])
    monkeypatch.setattr(wd, 'open_issue', lambda *a: delivered)
    monkeypatch.setattr(sys, 'argv', args)
    assert wd.main() == (0 if delivered else 1)
    monkeypatch.setattr(sys, 'argv', [a for a in args if a != '--issue'])
    assert wd.main() == 1  # report-only mode still reports the missing/held week


def test_issue_delivery_result_includes_dedup_and_suppression(monkeypatch):
    title = 'Weekly run has not started: 2026-11-16'
    for issues in ([], [{'title': title}], [{'title': 'Weekly run FAILED: 2026-11-16'}]):
        github(monkeypatch, issues)
        assert wd.open_issue(title, 'offline') is True


@pytest.mark.parametrize('fail_on', ['list', 'create'])
def test_issue_delivery_failure_returns_false(monkeypatch, fail_on):
    def run(args, **kwargs):
        if args[2] == fail_on:
            raise subprocess.CalledProcessError(1, args)
        return SimpleNamespace(stdout='[]')
    monkeypatch.setattr(wd.subprocess, 'run', run)
    assert wd.open_issue('Weekly run has not started: 2026-11-16', 'offline') is False
