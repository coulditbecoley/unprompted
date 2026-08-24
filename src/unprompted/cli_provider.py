"""Run a provider that lives on this machine as a command line tool.

Why this exists: the extraction pass is a mechanical reading job that does not
need web search, and a CLI already signed in on the operator's machine does it
without spending API credit. It also breaks a real dependency, since the API
extractor hitting a spend limit stopped a whole week's chart.

It is the only place in the project that starts a process from registry data,
and it is deliberately not reachable from the website. See lib/providers.ts for
the boundary this is the far side of.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "providers.json"

# A CLI answering a reading task should never take this long. The cap keeps one
# wedged process from stalling a 225-call run behind it.
TIMEOUT_SECONDS = 180

# The CLIs this project knows how to talk to, and the exact arguments that make
# each one read a prompt on stdin. Mirrors KNOWN_CLIS in lib/providers.ts.
#
# An allowlist rather than a name pattern, because the arguments are the risk.
# `python` and `powershell` are both plain executable names that pass any
# reasonable pattern, and `["-c", "..."]` after either one is a program. This is
# the side that actually spawns the process, and providers.json can be edited by
# hand without passing through the admin route at all, so the constraint has to
# live here too. Adding a CLI is a code change, on purpose.
# Each entry's arguments are pinned, not merely permitted, because they are the
# harness's safety settings as much as its plumbing. Every combination below was
# run against the real binary before being pinned; --help is not evidence. In
# particular `claude --tools ""`, which the help text says disables all tools,
# was observed reading a file from disk, so it is deliberately not relied on
# here. The empty working directory in ask() is what actually holds.
ALLOWED_CLIS: dict[str, tuple[str, ...]] = {
    # --strict-mcp-config: no MCP servers from the operator's own config, so the
    # extraction pass cannot reach whatever tools they have connected.
    "claude": ("-p", "--strict-mcp-config"),
    # --ignore-user-config drops hooks and MCP servers; --ignore-rules drops
    # execpolicy; --sandbox read-only blocks writes from model-generated shell
    # commands. The trailing "-" makes it read the prompt from stdin and must
    # stay last.
    "codex": (
        "exec",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "-",
    ),
    # Not installed here, so unverified: left at its documented invocation
    # rather than given hardening flags nobody has run.
    "gemini": ("-p",),
}


# What a CLI harness needs to start and find its own credentials, and nothing
# else. An allowlist rather than a denylist of key names: a denylist has to be
# updated every time a new secret joins the pipeline's environment, and the one
# that gets forgotten is the one that leaks.
#
# The harnesses authenticate from their own config directories on disk, not from
# these variables, so dropping the provider keys costs nothing.
_ENV_ALLOWLIST = (
    "PATH", "PATHEXT", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "COMSPEC",
    "WINDIR", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "USERNAME",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR",
    "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS", "LANG", "LC_ALL",
    # Where the harnesses keep their own auth and settings.
    "CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME",
)


def _child_env() -> dict[str, str]:
    """The environment an extractor process gets: no keys, no tokens."""
    return {k: v for k, v in os.environ.items() if k in _ENV_ALLOWLIST}


class ProviderError(RuntimeError):
    """A CLI call that did not succeed.

    Carries whatever the process printed, because a harness can fail *after*
    doing the work: the operator's own SessionEnd hooks run on every invocation,
    and one of them failing makes claude exit 1 with a perfectly good answer
    already on stdout. Throwing that away turned finished extractions into
    errors and pushed a week over its error-rate limit.
    """

    def __init__(self, message: str, stdout: str = "") -> None:
        super().__init__(message)
        self.stdout = stdout


@dataclass(frozen=True)
class CliProvider:
    id: str
    label: str
    command: str
    args: tuple[str, ...]

    def resolve(self) -> str:
        """Full path to the executable, or raise.

        `shutil.which` matters on Windows, where these tools install as `.CMD`
        shims that are not found by bare name.
        """
        expected = ALLOWED_CLIS.get(self.command)
        if expected is None:
            raise ProviderError(
                f"{self.id}: {self.command!r} is not a known CLI "
                f"(allowed: {', '.join(sorted(ALLOWED_CLIS))})"
            )
        if self.args != expected:
            raise ProviderError(
                f"{self.id}: args for {self.command} must be exactly {list(expected)}, "
                f"got {list(self.args)}"
            )
        found = shutil.which(self.command)
        if not found:
            raise ProviderError(f"{self.id}: {self.command} is not on PATH")
        return found

    def ask(self, prompt: str) -> str:
        """Send a prompt on stdin, return stdout. Never uses a shell.

        The prompt embeds a verbatim answer from a model that searched the open
        web, so it is untrusted text being handed to a coding agent that can
        read files and run commands. Two containments, neither depending on a
        given CLI's flags behaving as its --help claims:

        * an empty working directory, so the repository, its git history and
          the operator's home project are not reachable by a relative path;
        * a scrubbed environment, so no provider key or GitHub token is
          readable by the process even if the prompt talks it into looking.

        Neither is a sandbox. A CLI harness can still reach the network and the
        wider filesystem by absolute path. They remove the easy paths, and the
        per-CLI flags in ALLOWED_CLIS remove more.
        """
        # ignore_cleanup_errors because on Windows the harness can still hold a
        # handle inside the directory when the call returns, and the resulting
        # PermissionError was raised *after* a successful read, throwing away a
        # good answer and recording it as a failed extraction. The directory is
        # empty and lives under %TEMP%, so failing to remove it costs nothing.
        with tempfile.TemporaryDirectory(
            prefix="unprompted-extract-", ignore_cleanup_errors=True
        ) as jail:
            return self._run(prompt, jail)

    def _run(self, prompt: str, cwd: str) -> str:
        try:
            result = subprocess.run(
                [self.resolve(), *self.args],
                input=prompt,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                encoding="utf-8",
                errors="replace",
                cwd=cwd,
                env=_child_env(),
            )
        except subprocess.TimeoutExpired as exc:
            raise ProviderError(f"{self.id}: timed out after {TIMEOUT_SECONDS}s") from exc

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()[:300]
            raise ProviderError(
                f"{self.id}: exit {result.returncode}: {detail}",
                stdout=result.stdout or "",
            )
        return result.stdout.strip()


def load_registry() -> list[dict]:
    if not REGISTRY.exists():
        return []
    try:
        return json.loads(REGISTRY.read_text(encoding="utf-8")).get("providers", [])
    except (json.JSONDecodeError, AttributeError):
        return []


def declared_clis(role: str) -> list[CliProvider]:
    """Every enabled CLI registered for a role, in registry order.

    Declared, not necessarily present. Availability is a separate question from
    intent, and the two must not be collapsed: an engine the operator declared
    and this machine cannot run is a reason to stop, not a reason to quietly
    measure a smaller field.
    """
    out: list[CliProvider] = []
    for entry in load_registry():
        if not (
            entry.get("kind") == "cli"
            and entry.get("role") == role
            and entry.get("enabled")
        ):
            continue
        out.append(
            CliProvider(
                id=entry.get("id", "cli"),
                label=entry.get("label", entry.get("id", "cli")),
                command=entry.get("command", ""),
                args=tuple(entry.get("args") or ()),
            )
        )
    return out


def is_available(provider: CliProvider) -> bool:
    """Whether this machine can actually run it."""
    try:
        provider.resolve()
        return True
    except ProviderError:
        return False


def cli_extractor() -> CliProvider | None:
    """The first enabled local extractor that actually exists on this machine.

    Returns one rather than merging several: two extractors reading the same
    week would make the numbers depend on which one happened to run.

    Unlike an engine, a missing extractor is not fatal. Extraction is a
    mechanical reading job with a hosted fallback that produces the same answer,
    so falling through costs money rather than meaning. A missing *engine*
    changes what was measured, so run.py refuses to start instead.
    """
    for provider in declared_clis("extractor"):
        if is_available(provider):
            return provider
        print(
            f"  cli extractor unavailable: {provider.id} "
            f"({provider.command} is not on PATH)",
            file=sys.stderr,
        )
    return None


_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def parse_json_reply(text: str) -> dict:
    """Pull one JSON object out of a CLI's answer.

    The API path gets a schema-enforced object; a CLI returns prose that usually
    contains one. Fenced blocks and a leading sentence are both common, so both
    are tolerated rather than treated as failures.
    """
    candidates = [m.group(1) for m in _FENCE.finditer(text)]
    candidates.append(text)

    for chunk in candidates:
        chunk = chunk.strip()
        start, end = chunk.find("{"), chunk.rfind("}")
        if start == -1 or end <= start:
            continue
        try:
            parsed = json.loads(chunk[start : end + 1])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise ProviderError(f"no JSON object in reply: {text[:200]!r}")
