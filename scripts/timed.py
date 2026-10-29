"""Run a command with a wall-clock limit: `python scripts/timed.py <seconds> <command...>`.

cmd has no timeout for a child process, and a git network call that hangs runs
into Task Scheduler's eight-hour kill, which commits nothing at all. Output goes
where the caller redirected it; exit 124 means the limit was reached.
"""
import subprocess
import sys

if __name__ == "__main__":
    seconds, *command = sys.argv[1:]
    try:
        raise SystemExit(subprocess.run(command, timeout=float(seconds)).returncode)
    except subprocess.TimeoutExpired:
        print(f"timed out after {seconds}s: {' '.join(command)}", file=sys.stderr)
        raise SystemExit(124)
