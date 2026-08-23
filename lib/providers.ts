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
 * Detection is the one place the web app touches a binary, and it is limited
 * to the fixed allowlist in KNOWN_CLIS below. It never probes a name supplied
 * by a request.
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
  id: string;
  label: string;
  command: string;
  args: string[];
  versionArgs: string[];
}> = [
  {
    id: "claude-cli",
    label: "Claude Code",
    command: "claude",
    args: ["-p"],
    versionArgs: ["--version"],
  },
  {
    id: "codex-cli",
    label: "Codex",
    command: "codex",
    args: ["exec", "-"],
    versionArgs: ["--version"],
  },
  {
    id: "gemini-cli",
    label: "Gemini",
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

/** Whether a provider is usable right now, and why not when it is not. */
export function providerStatus(p: Provider): { ready: boolean; detail: string } {
  if (!p.enabled) return { ready: false, detail: "DISABLED" };
  if (p.kind === "api") {
    return process.env[p.env ?? ""]
      ? { ready: true, detail: "READY" }
      : { ready: false, detail: "NO KEY" };
  }
  return { ready: true, detail: "LOCAL CLI" };
}
