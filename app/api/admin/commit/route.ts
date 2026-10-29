import { NextResponse } from "next/server";
import { load as loadYaml } from "js-yaml";

import { isAuthorised } from "@/lib/auth";
import { CATEGORIES } from "@/lib/categories";
import { CATEGORY, quarantineKey } from "@/lib/data";
import { KNOWN_CLIS } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO_OWNER = "coulditbecoley";
const REPO_NAME = "unprompted";

/** Only these two files are writable, and only at these exact paths. */
const TARGETS = {
  questions: `questions/${CATEGORY}.yml`,
  aliases: `aliases/${CATEGORY}.yml`,
  providers: "providers.json",
} as const;

type Target = keyof typeof TARGETS;

const MAX_BYTES = 64 * 1024;

export async function POST(request: Request) {
  // Defence in depth: proxy.ts gates /admin and /api/admin, and this route
  // checks again so a routing change can never silently expose the write path.
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { target, content, category = CATEGORY, baseline } = (payload ?? {}) as { target?: string; content?: string; category?: string; baseline?: string };
  if (!CATEGORIES.some(c => c.slug === category) || typeof baseline !== "string") return NextResponse.json({ error: "Category and editor baseline required" }, { status: 400 });

  if (typeof target !== "string" || !Object.hasOwn(TARGETS, target)) {
    return NextResponse.json({ error: "Unknown target" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Content is empty" }, { status: 400 });
  }
  if (Buffer.byteLength(content, "utf-8") > MAX_BYTES) {
    return NextResponse.json({ error: "Content too large" }, { status: 413 });
  }

  // Never commit YAML that the pipeline would then fail to parse. A broken
  // question bank would silently kill the next run.
  const invalid = validate(target as Target, content);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }
  if (target === "questions" && (loadYaml(content) as { category?: string }).category !== category) {
    return NextResponse.json({ error: "Question bank category must match the selected category" }, { status: 400 });
  }

  const filePath = target === "providers" ? "providers.json" : `${target}/${category}.yml`;
  const api = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  const head = await fetch(`${api}?ref=main`, { headers, cache: "no-store" });
  if (!head.ok) {
    return NextResponse.json(
      { error: `Could not read ${filePath} from GitHub (${head.status})` },
      { status: 502 },
    );
  }
  const current = (await head.json()) as { sha: string; content: string };
  if (Buffer.from(current.content, "base64").toString("utf-8").replace(/\r\n/g, "\n") !== baseline.replace(/\r\n/g, "\n")) return NextResponse.json({ error: "This file changed since you opened it. Reload and merge your edits." }, { status: 409 });
  // The runner refuses a changed question bank without a version bump, but
  // only when Monday's run starts, which then measures nothing that week.
  if (target === "questions") {
    const refusal = unversionedChange(baseline, content);
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
  }

  const put = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: `Admin: update ${filePath}`,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha: current.sha,
      branch: "main",
    }),
  });

  if (!put.ok) {
    const detail = await put.text();
    return NextResponse.json(
      { error: `GitHub rejected the commit (${put.status}): ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const result = (await put.json()) as { commit?: { html_url?: string } };
  return NextResponse.json({ ok: true, url: result.commit?.html_url });
}

/**
 * Why this question-bank edit must not commit, or null. Compared the way the
 * Python guard compares the spec: mappings by content whatever their key
 * order, lists in order, and only plain JSON values (no NaN, no cycles).
 */
function unversionedChange(baseline: string, content: string): string | null {
  let before: unknown, after: unknown;
  try {
    before = canonical(loadYaml(baseline));
    after = canonical(loadYaml(content));
  } catch (err) {
    return `The question bank must hold plain values only: ${err instanceof Error ? err.message : "unsupported value"}`;
  }
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return null;
  const { method_version: was, ...rest } = before as Record<string, unknown>;
  const { method_version: now, ...next } = after as Record<string, unknown>;
  if (JSON.stringify(rest) === JSON.stringify(next) || Number(now) > Number(was)) return null;
  // Conservative: compared with the file as opened, not the last published
  // week, so a bank already bumped but not yet measured asks for another bump.
  return "This changes the question bank without raising method_version. Raise it with every change (and add a dated note to METHODOLOGY.md): a bank that differs from the last published week without a bump stops the next weekly run.";
}

/** A JSON-safe copy with sorted keys; throws on cycles and non-finite numbers. */
function canonical(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return value;
  }
  if (typeof value !== "object") throw new Error(`unsupported ${typeof value}`);
  if (seen.has(value)) throw new Error("recursive alias");
  seen.add(value);
  const out = Array.isArray(value)
    ? value.map(v => canonical(v, seen))
    : value instanceof Date ? (() => { throw new Error("date value"); })()
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as Record<string, unknown>)[k], seen)]));
  seen.delete(value);
  return out;
}

function validate(target: Target, content: string): string | null {
  let parsed: unknown;
  try {
    parsed = target === "providers" ? JSON.parse(content) : loadYaml(content);
  } catch (err) {
    return `Not valid YAML: ${err instanceof Error ? err.message : "parse error"}`;
  }
  if (!parsed || typeof parsed !== "object") return "YAML must be a mapping";

  if (target === "questions") {
    const spec = parsed as Record<string, unknown>;
    if (!Number.isInteger(spec.method_version) || Number(spec.method_version) < 1) return "method_version must be a number";
    if (!Number.isInteger(spec.runs_per_question) || Number(spec.runs_per_question) < 1 || Number(spec.runs_per_question) > 100) {
      return "runs_per_question must be an integer from 1 to 100";
    }
    if (spec.max_brands !== undefined && (!Number.isInteger(spec.max_brands) || Number(spec.max_brands) < 1 || Number(spec.max_brands) > 50)) return "max_brands must be an integer from 1 to 50";
    if (!Array.isArray(spec.questions) || spec.questions.length === 0) {
      return "questions must be a non-empty list";
    }
    const ids = new Set<string>();
    for (const q of spec.questions as Array<Record<string, unknown>>) {
      if (typeof q?.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(q.id) || typeof q?.text !== "string" || !q.text.trim()) {
        return "every question needs an id and non-empty text";
      }
      if (ids.has(q.id)) return `duplicate question id: ${q.id}`;
      ids.add(q.id);
    }
  } else if (target === "providers") {
    const spec = parsed as Record<string, unknown>;
    if (!Array.isArray(spec.providers)) return "providers must be a list";
    const ids = new Set<string>();
    for (const raw of spec.providers as Array<Record<string, unknown>>) {
      const { id, label, kind, role, enabled, command, env } = raw ?? {};
      if (typeof id !== "string" || !id.trim()) return "every provider needs an id";
      if (ids.has(id)) return `duplicate provider id: ${id}`;
      ids.add(id);
      if (typeof label !== "string" || !label.trim()) return `${id} needs a label`;
      if (kind !== "api" && kind !== "cli") return `${id}: kind must be api or cli`;
      if (role !== "engine" && role !== "extractor") {
        return `${id}: role must be engine or extractor`;
      }
      if (typeof enabled !== "boolean") return `${id}: enabled must be true or false`;
      const apiContract: Record<string, [string, string]> = {
        chatgpt: ["engine", "OPENAI_API_KEY"], claude: ["engine", "ANTHROPIC_API_KEY"],
        perplexity: ["engine", "PERPLEXITY_API_KEY"], gemini: ["engine", "GEMINI_API_KEY"],
        "claude-api-extract": ["extractor", "ANTHROPIC_API_KEY"],
      };
      if (kind === "api" && (!Object.hasOwn(apiContract, id) || role !== apiContract[id][0] || env !== apiContract[id][1])) return `${id}: unsupported API role or credential variable`;
      if (enabled && kind === "api" && !(["chatgpt", "claude", "perplexity", "gemini", "claude-api-extract"].includes(id))) return `${id}: no supported API adapter`;

      if (kind === "api" && (typeof env !== "string" || !env.trim())) {
        return `${id}: an api provider needs the name of its key variable`;
      }
      if (kind === "cli") {
        // The command and its arguments are executed later by the local
        // pipeline, so a committed entry must match a CLI this project already
        // knows how to talk to, argument for argument.
        //
        // Restricting the command alone was not enough. `python` and
        // `powershell` are plain executable names, and their arguments are a
        // program: an entry of `python` with `["-c", "..."]` passed every check
        // here and ran as written on the operator's machine the next time the
        // pipeline was invoked. Adding a CLI stays a code change to KNOWN_CLIS,
        // which is the posture lib/providers.ts already documents for detection.
        const known = KNOWN_CLIS.find((k) => k.command === command);
        if (!known) {
          const names = KNOWN_CLIS.map((k) => k.command).join(", ");
          return `${id}: unknown CLI "${String(command)}". Supported: ${names}. Adding one is a code change to KNOWN_CLIS.`;
        }
        const args = raw.args ?? [];
        if (
          !Array.isArray(args) ||
          args.length !== known.args.length ||
          args.some((a, i) => a !== known.args[i])
        ) {
          return `${id}: args for ${known.command} must be exactly ${JSON.stringify(known.args)}`;
        }
      }
    }
  } else {
    const spec = parsed as Record<string, unknown>;
    const canonical = spec.canonical;
    if (!canonical || typeof canonical !== "object" || Array.isArray(canonical)) return "aliases needs a canonical mapping";
    if (spec.exclude != null && (!Array.isArray(spec.exclude) || spec.exclude.some(x => typeof x !== "string" || !x.trim()))) return "exclude must be a list of non-empty strings";
    const excluded = new Set((Array.isArray(spec.exclude) ? spec.exclude : []).map(quarantineKey));
    const owners = new Map<string, string>();
    for (const [name, list] of Object.entries(canonical as Record<string, unknown>)) {
      if (!name.trim()) return "canonical names cannot be empty";
      if (list !== null && !Array.isArray(list)) {
        return `aliases for ${name} must be a list`;
      }
      if (Array.isArray(list) && list.some(x => typeof x !== "string" || !x.trim())) return `aliases for ${name} must contain non-empty strings`;
      for (const spelling of [name, ...(Array.isArray(list) ? list : [])]) {
        const key = quarantineKey(spelling);
        if (excluded.has(key)) return `charted alias is also excluded: ${spelling}`;
        if (owners.has(key) && owners.get(key) !== name) return `alias collision: ${spelling}`;
        owners.set(key, name);
      }
    }
  }

  return null;
}
