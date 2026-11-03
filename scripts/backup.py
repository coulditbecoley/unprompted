"""Local, append-only evidence snapshots. OneDrive copies are NOT remote verification."""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import fnmatch
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import socket
import stat
import sys
import tempfile
import time
import uuid

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))
from unprompted.storage import LockBusy, record_status, run_lock, write_json

RULES = (".env*", "auth", "*.pem", "credentials*", "*.lock", ".pending-*.tmp", "__pycache__")


def sources():
    return {**{name: REPO / name for name in (".unprompted", "private", "data", "reports", "audit/jev-shadow")},
            "analytics": Path.home() / "FenrirVault/Projects/Unprompted/Analytics"}


def check_deadline(deadline):
    if time.monotonic() >= deadline:
        raise TimeoutError("backup deadline reached")


def safe_path(path):
    """Reject reparse points anywhere in a path, including a destination ancestor."""
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("symlink/junction path")


def digest(path, deadline):
    safe_path(path)
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while True:
            check_deadline(deadline)
            block = stream.read(1024 * 1024)
            if not block:
                break
            h.update(block)
            size += len(block)
    return h.hexdigest(), size


def object_path(dest, sha):
    if not isinstance(sha, str) or not re.fullmatch("[0-9a-f]{64}", sha):
        raise ValueError("invalid object hash")
    return dest / "objects" / sha[:2] / sha


def install_object(source, dest, sha, size, deadline):
    target = object_path(dest, sha)
    safe_path(target)
    if target.exists() and digest(target, deadline) == (sha, size):
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".pending-", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as out, source.open("rb") as inp:
            h = hashlib.sha256()
            count = 0
            while True:
                check_deadline(deadline)
                block = inp.read(1024 * 1024)
                if not block:
                    break
                out.write(block)
                h.update(block)
                count += len(block)
            out.flush()
            os.fsync(out.fileno())
        if (h.hexdigest(), count) != (sha, size):
            raise ValueError("source changed during copy")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def collect(root, label, stage, manifest, deadline, destinations):
    manifest["sources"][label] = {}
    try:
        safe_path(root)
        if not root.exists():
            manifest["missing_optional"].append(label)
            return
        if not root.is_dir():
            raise ValueError("source is not a directory")
        for folder, dirs, files in os.walk(root, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
            for name in list(dirs) + files:
                path = Path(folder) / name
                relative = path.relative_to(root).as_posix()
                rule = next((r for r in RULES if fnmatch.fnmatchcase(name.lower(), r)), None)
                if not rule:
                    try:
                        safe_path(path)
                    except ValueError:
                        rule = "symlink/junction"
                if not rule and any(path == d or d in path.parents for d in destinations):
                    rule = "destination"
                if rule:
                    manifest["excluded"][rule] = manifest["excluded"].get(rule, 0) + 1
                    if name in dirs:
                        dirs.remove(name)
                    continue
                if name in dirs:
                    continue
                try:
                    if not stat.S_ISREG(path.lstat().st_mode):
                        raise ValueError("not a regular file")
                    for attempt in range(2):
                        try:
                            sha, size = digest(path, deadline)
                            install_object(path, stage, sha, size, deadline)
                            if digest(path, deadline) != (sha, size):
                                raise ValueError("source changed during copy")
                            manifest["sources"][label][relative] = {"sha": sha, "size": size}
                            break
                        except ValueError:
                            if attempt:
                                raise
                except (OSError, ValueError) as exc:
                    manifest["incomplete"].append(f"{label}/{relative}: {type(exc).__name__}")
                    if isinstance(exc, TimeoutError):
                        return
    except (OSError, ValueError) as exc:
        manifest["incomplete"].append(f"{label}: {type(exc).__name__}")


def snapshot(dest, stage, manifest, deadline):
    safe_path(dest)
    for files in manifest["sources"].values():
        for entry in files.values():
            install_object(object_path(stage, entry["sha"]), dest, entry["sha"], entry["size"], deadline)
    check_deadline(deadline)
    folder = dest / "snapshots"
    safe_path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = folder / f"{name}.json"
    if path.exists():
        path = folder / f"{name}-{uuid.uuid4().hex}.json"
    write_json(path, manifest)  # Create only, and only after all objects are durable.
    return path


def backup(destinations, deadline):
    manifest = {"schema": 1, "created": datetime.now(timezone.utc).isoformat(), "host": socket.gethostname(),
                "sources": {}, "excluded": {}, "incomplete": [], "skipped_roots": [], "missing_optional": []}
    roots = sources()
    results = []
    with tempfile.TemporaryDirectory(prefix="unprompted-backup-") as temporary:
        stage = Path(temporary)
        with ExitStack() as locks:
            try:
                locks.enter_context(run_lock(REPO / ".unprompted", "week.lock"))
                locks.enter_context(run_lock(REPO / ".unprompted", "run.lock"))
            except LockBusy:
                locks.close()
                manifest["skipped_roots"] = [".unprompted", "data"]
            except OSError as exc:
                locks.close()
                manifest["skipped_roots"] = [".unprompted", "data"]
                manifest["incomplete"].append(f"locks: {type(exc).__name__}")
            for label, root in roots.items():
                if label not in manifest["skipped_roots"]:
                    collect(root, label, stage, manifest, deadline, [d for d, _ in destinations])
        for dest, kind in destinations:
            result = {"destination": str(dest), "attempted": True, "kind": kind, "local_complete": False,
                      "newest_snapshot": None, "incomplete": len(manifest["incomplete"]),
                      "skipped": len(manifest["skipped_roots"])}
            try:
                if any(dest == r or dest in r.parents or r in dest.parents for r in roots.values()):
                    raise ValueError("destination overlaps source")
                result["newest_snapshot"] = str(snapshot(dest, stage, manifest, deadline))
                result["local_complete"] = not (manifest["incomplete"] or manifest["skipped_roots"])
            except (OSError, ValueError) as exc:
                result["error"] = f"{type(exc).__name__}: {exc}"[:500]
            results.append(result)
    return results


def restore_check(dest, deadline):
    safe_path(dest / "snapshots")
    snapshots = sorted((dest / "snapshots").glob("*.json"), key=lambda p: (p.lstat().st_mtime_ns, p.name))
    if not snapshots:
        raise ValueError("no snapshots")
    latest = snapshots[-1]
    safe_path(latest)
    manifest = json.loads(latest.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != 1 or not isinstance(manifest.get("sources"), dict):
        raise ValueError("invalid manifest")
    with tempfile.TemporaryDirectory(prefix="unprompted-restore-") as temporary:
        for index, files in enumerate(manifest["sources"].values()):
            if not isinstance(files, dict):
                raise ValueError("invalid source manifest")
            for name, entry in files.items():
                if not isinstance(entry, dict) or type(entry.get("size")) is not int or entry["size"] < 0:
                    raise ValueError("invalid object metadata")
                relative = PurePosixPath(name)
                if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name or PureWindowsPath(name).drive:
                    raise ValueError("unsafe manifest path")
                sha, size = entry["sha"], entry["size"]
                obj = object_path(dest, sha)
                if digest(obj, deadline) != (sha, size):
                    raise ValueError("corrupt object")
                target = Path(temporary) / str(index) / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                # Install through the same verified, fsynced copy path, then restore its name.
                local_store = Path(temporary) / "verified"
                install_object(obj, local_store, sha, size, deadline)
                os.link(object_path(local_store, sha), target)
    if manifest.get("incomplete") or manifest.get("skipped_roots"):
        raise ValueError("snapshot incomplete")
    return str(latest)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", action="append", type=Path)
    parser.add_argument("--deadline", type=float, default=1800)
    parser.add_argument("--restore-check", action="store_true")
    args = parser.parse_args(argv)
    if not math.isfinite(args.deadline) or args.deadline < 0:
        parser.error("deadline must be finite and nonnegative")
    deadline = time.monotonic() + args.deadline
    if args.dest:
        destinations = [(p.absolute(), "local") for p in args.dest]
    else:
        destinations = [(Path("E:/Backups/Unprompted"), "local")]
        if os.environ.get("OneDrive"):
            destinations.append((Path(os.environ["OneDrive"]) / "Backups/Unprompted", "cloud_pending"))
    if args.restore_check:
        results = []
        for dest, kind in destinations:
            row = {"destination": str(dest), "kind": kind, "attempted": True, "local_complete": False}
            try:
                row["newest_snapshot"] = restore_check(dest, deadline)
                row["local_complete"] = True
            except (OSError, ValueError, KeyError, TypeError) as exc:
                row["error"] = f"{type(exc).__name__}: {exc}"[:500]
            results.append(row)
    else:
        results = backup(destinations, deadline)
    if not args.dest and not os.environ.get("OneDrive"):
        results.append({"destination": "OneDrive", "kind": "cloud_pending", "attempted": False,
                        "local_complete": False, "error": "OneDrive is not configured"})
    ok = all(r["local_complete"] for r in results)
    record_status(REPO / ".unprompted/status", "backup_restore" if args.restore_check else "backup", ok,
                  "" if ok else "backup incomplete; see destinations", destinations=results)
    print(json.dumps(results, indent=2))
    return 0 if ok else (2 if any(r.get("newest_snapshot") for r in results) else 1)


if __name__ == "__main__":
    raise SystemExit(main())
