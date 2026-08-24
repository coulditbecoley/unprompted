import { NextResponse } from "next/server";
import { load as loadYaml } from "js-yaml";

import { isAuthorised } from "@/lib/auth";
import { CATEGORY } from "@/lib/data";
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

  const { target, content } = (payload ?? {}) as { target?: string; content?: string };

  if (typeof target !== "string" || !(target in TARGETS)) {
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

  const filePath = TARGETS[target as Target];
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
  const current = (await head.json()) as { sha: string };

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

function validate(target: Target, content: string): string | null {
  let parsed: unknown;
  try {
    parsed = loadYaml(content);
  } catch (err) {
    return `Not valid YAML: ${err instanceof Error ? err.message : "parse error"}`;
  }
  if (!parsed || typeof parsed !== "object") return "YAML must be a mapping";

  if (target === "questions") {
    const spec = parsed as Record<string, unknown>;
    if (typeof spec.method_version !== "number") return "method_version must be a number";
    if (typeof spec.runs_per_question !== "number" || spec.runs_per_question < 1) {
      return "runs_per_question must be a positive number";
    }
    if (!Array.isArray(spec.questions) || spec.questions.length === 0) {
      return "questions must be a non-empty list";
    }
    const ids = new Set<string>();
    for (const q of spec.questions as Array<Record<string, unknown>>) {
      if (typeof q?.id !== "string" || typeof q?.text !== "string" || !q.text.trim()) {
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
    if (!canonical || typeof canonical !== "object") return "aliases needs a canonical mapping";
    for (const [name, list] of Object.entries(canonical as Record<string, unknown>)) {
      if (!name.trim()) return "canonical names cannot be empty";
      if (list !== null && !Array.isArray(list)) {
        return `aliases for ${name} must be a list`;
      }
    }
  }

  return null;
}
