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
    # Only the calendar moves. freezegun also fakes the duration clocks, and
    # worker threads can see the real ones, so a run-clock check could pass on
    # one thread and refuse on another; the real ones are put back.
    # That includes aliases other modules imported by name (subprocess._time),
    # which freezegun records in undo_changes as (module, name, original).
    import time
    import freezegun.api as api
    real = {api.real_monotonic, api.real_monotonic_ns, api.real_perf_counter, api.real_perf_counter_ns}
    time.monotonic, time.monotonic_ns = api.real_monotonic, api.real_monotonic_ns
    time.perf_counter, time.perf_counter_ns = api.real_perf_counter, api.real_perf_counter_ns
    for module, name, original in _freezer.undo_changes:
        if original in real:
            setattr(module, name, original)


def pytest_unconfigure(config):
    if _freezer:
        _freezer.stop()
