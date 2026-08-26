/**
 * Reads the pipeline's output at build time.
 *
 * The Python side owns `data/runs/`. This side only ever reads it. There is no
 * database and no API between them: the repository is the interface, which is
 * what makes the archive publicly verifiable.
 */

import fs from "node:fs";
import path from "node:path";

import { load as loadYaml } from "js-yaml";

import { CATEGORIES, getCategory as getCategoryFromRegistry } from "./categories";
// The metric lives in its own module so the agreement check can run the same
// code the site does. Re-exported here because every page imports it from
// "@/lib/data" and the split is an implementation detail, not an API change.
import {
  answered,
  standings,
  type BrandStanding,
  type Extraction,
  type RunRecord,
  type Rates,
} from "./metrics";

export * from "./metrics";

export const REPO_ROOT = process.cwd();
const RUNS_DIR = path.join(REPO_ROOT, "data", "runs");

function isRunRecord(v: unknown): v is RunRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.category === "string" &&
    typeof r.run_date === "string" &&
    typeof r.method_version === "number" &&
    typeof r.runs_per_question === "number" &&
    Array.isArray(r.engines) &&
    Array.isArray(r.extractions) &&
    r.extractions.every(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        Array.isArray((e as Extraction).brands) &&
        (e as Extraction).brands.every(
          (b) => typeof b?.name === "string" && typeof b?.position === "number",
        ),
    )
  );
}

export function loadHistory(category: string): RunRecord[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const dates = fs
    .readdirSync(RUNS_DIR)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const runs: RunRecord[] = [];
  for (const date of dates) {
    const file = path.join(RUNS_DIR, date, `${category}.json`);
    if (!fs.existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      throw new Error(`${file} is not valid JSON`);
    }
    // Loud, not silent. A skipped week would quietly change every published
    // number and every week-over-week delta derived from it; a failed build is
    // the cheaper failure.
    if (!isRunRecord(parsed)) {
      throw new Error(`${file} is not a well-formed run record`);
    }
    if (parsed.category !== category || parsed.run_date !== date) {
      throw new Error(
        `${file} declares ${parsed.category}/${parsed.run_date}, which does not match its path`,
      );
    }
    runs.push(parsed);
  }
  return runs;
}

/**
 * Every run ever archived, newest date last, whatever category it belongs to.
 *
 * Deliberately a directory scan rather than a walk of CATEGORIES: a category
 * that has been retired still cost money and still exercised the engines, and
 * both of those are things the operator is accounting for. Filtering to the
 * live list would quietly under-report the bill.
 *
 * Malformed files are skipped rather than thrown on, which is the opposite of
 * loadHistory. The difference is what depends on it: a missing week there
 * changes a published number, while here it makes an operator's total slightly
 * low. Refusing to render the whole dashboard over one bad file would be the
 * worse trade.
 */
export function loadAllRuns(): RunRecord[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const runs: RunRecord[] = [];

  for (const date of fs.readdirSync(RUNS_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
    const dir = path.join(RUNS_DIR, date);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        if (isRunRecord(parsed)) runs.push(parsed);
      } catch {
        // Counted as not present. See above.
      }
    }
  }
  return runs;
}

export function latestRun(category: string): RunRecord | null {
  const history = loadHistory(category);
  return history.length ? history[history.length - 1] : null;
}

/**
 * The question ids a run's `steps` arrays are indexed by, in board order.
 *
 * First appearance rather than alphabetical, so a step lines up with the
 * published question bank. Exported because a step is meaningless without the
 * question it belongs to, and the comparison page names them.
 */
export function loadQuestionText(category: string): Record<string, string> {
  const file = path.join(REPO_ROOT, "questions", `${category}.yml`);
  if (!fs.existsSync(file)) return {};
  const spec = loadYaml(fs.readFileSync(file, "utf-8")) as
    | { questions?: Array<{ id?: string; text?: string }> }
    | undefined;
  const out: Record<string, string> = {};
  for (const q of spec?.questions ?? []) {
    if (typeof q?.id === "string" && typeof q?.text === "string") out[q.id] = q.text;
  }
  return out;
}

/**
 * Standings for one run.
 *
 * Ordered by first-named share ahead of rotation. In a field of five or six the
 * leader's rotation pins near 100% and stops moving, so ordering on rotation
 * alone would freeze the board. First-named share keeps discriminating.
 */
/**
 * How many runs of each question produced an answer, in board order.
 *
 * A property of the run rather than of a brand: every brand on the board shares
 * it, and it is not uniform across questions, because a question whose engine
 * errored has a smaller denominator than one where every engine answered.
 */
export function brandHistory(
  category: string,
  brand: string,
): Array<{ date: string; rotation: number; firstShare: number }> {
  return loadHistory(category).map((run) => {
    const row = standings(run).find((s) => s.brand === brand);
    return {
      date: run.run_date,
      rotation: row?.rotation ?? 0,
      firstShare: row?.firstShare ?? 0,
    };
  });
}

/* -- consensus ------------------------------------------------------------ */

export function allBrands(category: string): string[] {
  const names = new Set<string>();
  for (const run of loadHistory(category)) {
    for (const s of standings(run)) names.add(s.brand);
  }
  return [...names].sort();
}

/**
 * Re-exported for the pages that still speak in terms of "the" category.
 * The registry in lib/categories.ts is the single source of truth; these exist
 * so a page rendering the flagship board does not have to know that.
 */
export { DEFAULT_CATEGORY as CATEGORY } from "./categories";

export function categoryLabel(slug: string): string {
  return getCategoryFromRegistry(slug)?.label ?? slug;
}

// Pure helpers and constants live in lib/shared.ts so a client component can
// import them without the bundler following this file into node:fs. Re-exported
// here because every server caller already imports them from "@/lib/data".
export { DISCLOSURE, OPERATOR, OPERATOR_URL, slugify } from "./shared";


/**
 * How often an engine names its own product versus how often rivals name it.
 *
 * The reason the AI-tools category exists. Reported with its sample size
 * attached and never as an accusation: a small gap on a small sample is noise,
 * and saying so is the difference between a finding and a headline we cannot
 * defend.
 */
export type SelfPreference = {
  brand: string;
  engine: string;
  ownNamed: number;
  ownRuns: number;
  ownRate: number;
  rivalNamed: number;
  rivalRuns: number;
  rivalRate: number;
  gap: number;
};

/**
 * Brand -> the engines whose vendor makes it.
 *
 * A list rather than one name, because a vendor can field more than one engine:
 * Anthropic answers as both the hosted `claude` API and the local `claude-code`
 * harness. Counting the second as a rival of the first would understate exactly
 * the self-preference this publication exists to measure.
 *
 * Read with js-yaml, which is already a dependency. The hand-rolled regex this
 * replaces could only ever see a flat "Brand: engine" line, so it silently
 * returned nothing for a list and the ownership simply vanished.
 */
export function loadAffiliations(category: string): Record<string, string[]> {
  const file = path.join(REPO_ROOT, "aliases", `${category}.yml`);
  if (!fs.existsSync(file)) return {};
  const parsed = loadYaml(fs.readFileSync(file, "utf-8")) as
    | { affiliations?: Record<string, string | string[]> }
    | undefined;
  const raw = parsed?.affiliations;
  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, string[]> = {};
  for (const [brand, owner] of Object.entries(raw)) {
    if (typeof owner === "string") out[brand] = [owner];
    else if (Array.isArray(owner)) out[brand] = owner.filter((o) => typeof o === "string");
  }
  return out;
}

export function selfPreference(
  run: RunRecord,
  affiliations: Record<string, string[]>,
): SelfPreference[] {
  const answers = run.extractions.filter((e) => !e.error && !e.refused);
  const out: SelfPreference[] = [];

  for (const [brand, owner] of Object.entries(affiliations)) {
    const owners = typeof owner === "string" ? [owner] : owner;
    const own = answers.filter((e) => owners.includes(e.engine));
    const rival = answers.filter((e) => !owners.includes(e.engine));
    if (!own.length || !rival.length) continue;

    const namedIn = (rows: Extraction[]) =>
      rows.filter((e) => e.brands.some((b) => b.name === brand)).length;

    const ownNamed = namedIn(own);
    const rivalNamed = namedIn(rival);
    const ownRate = ownNamed / own.length;
    const rivalRate = rivalNamed / rival.length;

    out.push({
      brand,
      engine: owners.join(", "),
      ownNamed,
      ownRuns: own.length,
      ownRate,
      rivalNamed,
      rivalRuns: rival.length,
      rivalRate,
      gap: Math.round((ownRate - rivalRate) * 1000) / 10,
    });
  }

  out.sort((a, b) => b.gap - a.gap);
  return out;
}

export type HeldRun = { category: string; date: string; errorRate: number };

/**
 * Runs that failed their checks and were withheld.
 *
 * These live in data/held and are deliberately not readable by any public page.
 * The operator still needs to see them, because a held week is the one thing
 * that needs a person: it is the pipeline saying it would rather print nothing
 * than print something wrong.
 */
export function loadHeld(): HeldRun[] {
  const dir = path.join(REPO_ROOT, "data", "held");
  if (!fs.existsSync(dir)) return [];

  const out: HeldRun[] = [];
  for (const date of fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    for (const file of fs.readdirSync(path.join(dir, date))) {
      if (!file.endsWith(".json")) continue;
      try {
        const run = JSON.parse(
          fs.readFileSync(path.join(dir, date, file), "utf-8"),
        ) as RunRecord;
        const total = run.extractions.length;
        const errored = run.extractions.filter((e) => e.error).length;
        out.push({
          category: run.category,
          date: run.run_date,
          errorRate: total ? errored / total : 0,
        });
      } catch {
        // A corrupt held file must not take the dashboard down.
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The price list, read from the same file src/unprompted/cost.py reads.
 *
 * Not cached. It is one small file read on an admin request that is already
 * touching the whole run archive, and a stale price after an edit would be a
 * silently wrong money figure -- the one kind of wrong this page cannot afford.
 */
export function loadRates(): Rates {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "data", "rates.json"), "utf-8"),
  ) as Rates;
}

export type QuarantineEntry = { name: string; count: number };

/**
 * Unrecognised names from the most recent run of each live category.
 *
 * Deliberately not every file ever written. Quarantine is a to-do list, not an
 * archive: flattening all history produced hundreds of names, most of them
 * one-off hallucinations from categories that no longer exist, which buried the
 * handful that were real brands missing from the alias map.
 *
 * Sorted by how often each name appeared, because that is the triage signal. A
 * name seen forty times is a brand we are failing to count; a name seen once is
 * noise.
 */
export function loadQuarantine(): QuarantineEntry[] {
  const dir = path.join(REPO_ROOT, "data", "quarantine");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const counts = new Map<string, number>();

  for (const category of CATEGORIES) {
    // File names are `<date>-<category>.json`, so the newest sorts last.
    const latest = files
      .filter((f) => f.endsWith(`-${category.slug}.json`))
      .sort()
      .pop();
    if (!latest) continue;

    try {
      const names = JSON.parse(fs.readFileSync(path.join(dir, latest), "utf-8"));
      if (!Array.isArray(names)) continue;
      for (const raw of names) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    } catch {
      // A corrupt file must not take the dashboard down.
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
