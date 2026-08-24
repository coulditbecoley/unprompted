import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@/lib/data";

/**
 * The provider registry.
 *
 * A provider is anything that can answer or read a prompt: a hosted API, or a
 * CLI already installed on the operator's machine. Keeping them in one
 * versioned file means adding a provider is a commit on the public repo, same
 * as a question change, rather than a hidden setting.
 *
 * ---------------------------------------------------------------------------
 * SECURITY BOUNDARY, DO NOT ERODE THIS
 *
 * A registry entry names a command. Nothing in the web application may ever
 * spawn a process from that value. If it did, anyone holding the admin
 * password would have remote code execution on whatever host runs the
 * dashboard, and an admin password is not a strong enough gate for that.
 *
 * Execution happens in exactly one place: the local Python pipeline, invoked
 * by a human or a scheduled task on the machine that owns the CLIs.
 *
 * The web app spawns no process at all, not even a limited one. Detection used
 * to run each allowlisted binary with `--version`; it now resolves the name
 * against PATH and reports the path, which answers the same question without a
 * child process. Nothing here should reintroduce one.
 *
 * KNOWN_CLIS is also the allowlist the admin commit route validates against,
 * command *and* arguments. The arguments are a harness's safety settings as
 * much as its plumbing, so they are pinned rather than merely permitted, and
 * ALLOWED_CLIS in src/unprompted/cli_provider.py mirrors this list on the side
 * that actually executes. A test fails if the two drift.
 */

export type ProviderRole = "engine" | "extractor";

export type Provider = {
  id: string;
  label: string;
  /** `api` reads a key from the environment. `cli` shells out locally. */
  kind: "api" | "cli";
  role: ProviderRole;
  enabled: boolean;
  /** api only: the environment variable holding the key. */
  env?: string;
  /** cli only: the executable, and the arguments that make it read stdin. */
  command?: string;
  args?: string[];
  /** Free-text note from whoever added it. */
  note?: string;
};

/**
 * CLIs we know how to talk to, and the arguments that make each one read a
 * prompt on stdin and print a plain answer.
 *
 * This list is the allowlist for detection. Adding to it is a code change on
 * purpose: a scan must never be able to discover and offer to run something an
 * attacker named.
 */
export const KNOWN_CLIS: Array<{
  /** Registry id when added as an extractor. */
  id: string;
  label: string;
  /**
   * Registry id when added as an engine. Separate from `id` because an engine
   * id is a public chart row and a vendor can field both roles at once, so the
   * two must be able to coexist in one registry. Kept readable for the same
   * reason: it is printed in the status bar and the weekly note.
   */
  engineId: string;
  engineLabel: string;
  command: string;
  args: string[];
  versionArgs: string[];
}> = [
  {
    id: "claude-cli",
    label: "Claude Code",
    engineId: "claude-code",
    engineLabel: "Claude Code (local)",
    command: "claude",
    // --strict-mcp-config keeps the operator's MCP servers out of a pass that
    // is only meant to read one block of prose.
    args: ["-p", "--strict-mcp-config"],
    versionArgs: ["--version"],
  },
  {
    id: "codex-cli",
    label: "Codex",
    engineId: "codex",
    engineLabel: "Codex (local)",
    command: "codex",
    // --skip-git-repo-check because the pipeline runs it from an empty
    // directory, and codex otherwise refuses outside a trusted repository.
    // The rest drop the operator's hooks, MCP servers and execpolicy, and stop
    // model-generated shell commands from writing anything. The trailing "-"
    // reads the prompt from stdin and must stay last.
    args: [
      "exec",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "-",
    ],
    versionArgs: ["--version"],
  },
  {
    id: "gemini-cli",
    label: "Gemini",
    engineId: "gemini-cli-engine",
    engineLabel: "Gemini (local)",
    command: "gemini",
    args: ["-p"],
    versionArgs: ["--version"],
  },
];

export const PROVIDERS_PATH = path.join(REPO_ROOT, "providers.json");

const BUILT_IN: Provider[] = [
  { id: "chatgpt", label: "ChatGPT", kind: "api", role: "engine", enabled: true, env: "OPENAI_API_KEY" },
  { id: "claude", label: "Claude", kind: "api", role: "engine", enabled: true, env: "ANTHROPIC_API_KEY" },
  { id: "perplexity", label: "Perplexity", kind: "api", role: "engine", enabled: true, env: "PERPLEXITY_API_KEY" },
];

export function loadProviders(): Provider[] {
  if (!fs.existsSync(PROVIDERS_PATH)) return BUILT_IN;
  try {
    const raw = JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf-8"));
    const list = Array.isArray(raw?.providers) ? raw.providers : [];
    return list.filter(isProvider);
  } catch {
    // A malformed registry must not take the dashboard down; the operator needs
    // the dashboard precisely in order to fix it.
    return BUILT_IN;
  }
}

function isProvider(v: unknown): v is Provider {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.label === "string" &&
    (p.kind === "api" || p.kind === "cli") &&
    (p.role === "engine" || p.role === "extractor") &&
    typeof p.enabled === "boolean"
  );
}

/**
 * Resolve a bare command name against PATH, the way a shell would.
 *
 * On Windows the extension is what makes a file executable and these tools
 * install as `.CMD` shims, so extensions are tried before the bare name.
 * Returns the resolved path, or null when nothing on PATH matches.
 */
export function resolveOnPath(command: string): string | null {
  const isWindows = process.platform === "win32";
  const extensions = isWindows
    ? [...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean), ""]
    : [""];

  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, command + extension);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Not there, or not readable. Try the next one.
      }
    }
  }
  return null;
}

/**
 * Whether a provider is usable right now, and why not when it is not.
 *
 * A local CLI used to report "LOCAL CLI" unconditionally, which read as ready
 * whether or not the thing existed. That was harmless while CLIs only did
 * extraction, which falls back. It is not harmless now that one can be an
 * engine: an engine that is not installed stops the run outright, and the
 * dashboard is where you would go to find out why.
 */
export function providerStatus(p: Provider): { ready: boolean; detail: string } {
  if (!p.enabled) return { ready: false, detail: "DISABLED" };
  if (p.kind === "api") {
    return process.env[p.env ?? ""]
      ? { ready: true, detail: "READY" }
      : { ready: false, detail: "NO KEY" };
  }
  if (process.env.VERCEL) {
    // A serverless function cannot see the operator's laptop, so "missing"
    // here would be a lie rather than a finding.
    return { ready: false, detail: "LOCAL ONLY" };
  }
  return resolveOnPath(p.command ?? "")
    ? { ready: true, detail: "ON PATH" }
    : { ready: false, detail: "NOT INSTALLED" };
}
