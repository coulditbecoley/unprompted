"""Durable local writes and a process lock for paid work."""
import json
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


def write_json(path: Path, value: object, *, replace: bool = False) -> None:
    write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n", replace=replace)


def write_text(path: Path, value: str, *, replace: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pending-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            # Atomic create-if-absent: a competing writer cannot replace a winner.
            os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextmanager
def run_lock(root: Path, name: str = "run.lock", wait: float = 0.0):
    """Exclusive lock on root/name; raises OSError if still held after `wait` seconds.

    run.lock serialises paid jobs. week.lock spans one whole weekly run, all
    categories included, and the daily sync's git pull, so inputs cannot
    change between two categories of one week.
    """
    # ponytail: serialize paid jobs; separate reservations if parallel jobs are needed.
    root.mkdir(parents=True, exist_ok=True)
    with (root / name).open("a+b") as stream:
        stream.seek(0)
        stream.write(b"0")
        stream.flush()
        stream.seek(0)
        deadline = time.monotonic() + wait
        while True:
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def record_status(folder: Path, name: str, ok: bool, error: str = "", **detail: object) -> dict:
    """Write `<folder>/<name>.json`: when this job last ran and when it last worked.

    A failure keeps the previous last_success, so a stale success is visible as
    stale (readiness and the mid-week check alarm on age), instead of every
    attempt looking like progress. Never raises: a status that cannot be written
    must not turn a working job into a failing one.
    """
    path = folder / f"{name}.json"
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    status = {"name": name, "last_attempt": now, "ok": ok, "error": error[-500:],
              "last_success": now if ok else previous.get("last_success"), **detail}
    try:
        write_json(path, status, replace=True)
    except OSError:
        pass
    return status
