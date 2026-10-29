"""pytest plugin: run the suite as if today were FAKE_TODAY (ISO date or datetime).

    FAKE_TODAY=2026-12-15T10:00:00 PYTHONPATH=tests python -m pytest -q -p future_date

CI runs the suite 45 days ahead with this. Two tests once dated a paid run
2026-10-26, which the month rule refuses from November: date-fragile tests
fail here instead of on the first push of a new month.
"""
import os

from freezegun import freeze_time

_freezer = None


def pytest_configure(config):
    global _freezer
    _freezer = freeze_time(os.environ["FAKE_TODAY"], tick=True)
    _freezer.start()


def pytest_unconfigure(config):
    if _freezer:
        _freezer.stop()
