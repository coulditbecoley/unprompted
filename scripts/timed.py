"""Run a command with a wall-clock limit: `python scripts/timed.py <seconds> <command...>`.

cmd has no timeout for a child process, and a git network call that hangs runs
into Task Scheduler's eight-hour kill, which commits nothing at all. Output goes
where the caller redirected it; exit 124 means the limit was reached.

On timeout the whole process tree is ended, not just the immediate child: git
hands network work to remote and credential helpers that would otherwise keep
going after this script has reported failure.
"""
import os
import signal
import subprocess
import sys


def run(seconds: float, command: list[str]) -> int:
    # Its own process group on POSIX, so the whole group can be ended.
    process = subprocess.Popen(command, start_new_session=os.name != "nt")
    try:
        return process.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        print(f"timed out after {seconds}s: {' '.join(command)}", file=sys.stderr)
        return 124


if __name__ == "__main__":
    seconds, *command = sys.argv[1:]
    raise SystemExit(run(float(seconds), command))
