"""Durable local writes and a process lock for paid work."""
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


def write_json(path: Path, value: object, *, replace: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".pending-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
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
def run_lock(root: Path):
    # ponytail: serialize paid jobs; separate reservations if parallel jobs are needed.
    root.mkdir(parents=True, exist_ok=True)
    with (root / "run.lock").open("a+b") as stream:
        stream.seek(0)
        stream.write(b"0")
        stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)
