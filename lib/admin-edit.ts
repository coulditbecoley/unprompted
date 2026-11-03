import { load as loadYaml } from "js-yaml";

/** One replacement block, omitting the unchanged beginning and end. */
export function editDiff(before: string, after: string): string {
  const lines = (text: string) => text.replace(/\r\n/g, "\n").split("\n");
  const oldLines = lines(before), newLines = lines(after);
  let start = 0, oldEnd = oldLines.length, newEnd = newLines.length;
  while (start < oldEnd && start < newEnd && oldLines[start] === newLines[start]) start++;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd--; }
  return [...oldLines.slice(start, oldEnd).map(line => `- ${line}`),
    ...newLines.slice(start, newEnd).map(line => `+ ${line}`)].join("\n");
}

/**
 * Why this question-bank edit must not commit, or null. Compared the way the
 * Python guard compares the spec: mappings by content whatever their key
 * order, lists in order, and only plain JSON values (no NaN, no cycles).
 */
export function unversionedChange(baseline: string, content: string): string | null {
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

