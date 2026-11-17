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
