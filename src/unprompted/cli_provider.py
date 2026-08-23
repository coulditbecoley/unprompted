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
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "providers.json"

# A CLI answering a reading task should never take this long. The cap keeps one
# wedged process from stalling a 225-call run behind it.
TIMEOUT_SECONDS = 180

# Same shape the admin route enforces. Re-checked here because this is the side
# that actually executes, and a file can be edited by hand.
SAFE_COMMAND = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class ProviderError(RuntimeError):
    pass


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
        if not SAFE_COMMAND.match(self.command):
            raise ProviderError(f"{self.id}: unsafe command {self.command!r}")
        found = shutil.which(self.command)
        if not found:
            raise ProviderError(f"{self.id}: {self.command} is not on PATH")
        return found

    def ask(self, prompt: str) -> str:
        """Send a prompt on stdin, return stdout. Never uses a shell."""
        try:
            result = subprocess.run(
                [self.resolve(), *self.args],
                input=prompt,
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.TimeoutExpired as exc:
            raise ProviderError(f"{self.id}: timed out after {TIMEOUT_SECONDS}s") from exc

        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()[:300]
            raise ProviderError(f"{self.id}: exit {result.returncode}: {detail}")
        return result.stdout.strip()


def load_registry() -> list[dict]:
    if not REGISTRY.exists():
        return []
    try:
        return json.loads(REGISTRY.read_text(encoding="utf-8")).get("providers", [])
    except (json.JSONDecodeError, AttributeError):
        return []


def cli_extractor() -> CliProvider | None:
    """The enabled local extractor, if the operator configured one.

    Returns the first match rather than merging several: two extractors reading
    the same week would make the numbers depend on which one happened to run.
    """
    for entry in load_registry():
        if (
            entry.get("kind") == "cli"
            and entry.get("role") == "extractor"
            and entry.get("enabled")
        ):
            return CliProvider(
                id=entry.get("id", "cli"),
                label=entry.get("label", entry.get("id", "cli")),
                command=entry.get("command", ""),
                args=tuple(entry.get("args") or ()),
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
