/**
 * Reads the pipeline's output at build time.
 *
 * The Python side owns `data/runs/`. This side only ever reads it. There is no
 * database and no API between them: the repository is the interface, which is
 * what makes the archive publicly verifiable.
 */

import fs from "node:fs";
import { cache } from "react";
import path from "node:path";

import { load as loadYaml } from "js-yaml";

import { CATEGORIES, getCategory as getCategoryFromRegistry } from "./categories";
// The metric lives in its own module so the agreement check can run the same
// code the site does. Re-exported here because every page imports it from
// "@/lib/data" and the split is an implementation detail, not an API change.
import {
  answered,
  comparisonReason,
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

export const loadHistory = cache(function loadHistory(category: string, allReadings = false): RunRecord[] {
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
  if (allReadings) return runs;
  const byMeasurement = new Map(runs.map(r => [r.measured_on || r.run_date, r]));
  return [...byMeasurement.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
});

export type ArchiveScan = {
  runs: RunRecord[];
  /** Files that could not be trusted, by path, with why. Empty is the normal case. */
  errors: string[];
};

/**
 * Every run ever archived, newest date last, whatever category it belongs to.
 *
 * Deliberately a directory scan rather than a walk of CATEGORIES: a category
 * that has been retired still cost money and still exercised the engines, and
 * both of those are things the operator is accounting for. Filtering to the live
 * list would quietly under-report the bill.
 *
 * Malformed files are collected rather than thrown on, which is the opposite of
 * loadHistory. The difference is what depends on it: a missing week there
 * changes a published number, while refusing to render the whole dashboard over
 * one bad file is the worse trade for an operator trying to find out what is
 * wrong. But they are *returned*, not swallowed -- a total that quietly omits a
 * file while the page calls it "every run ever recorded" is a confident lie, and
 * the caller marks the affected figures incomplete.
 *
 * The path-identity check is loadHistory's, for the same reason: a file whose
 * declared date disagrees with the directory it sits in can silently move which
 * run counts as the latest, and the latest run is what the whole page is about.
 */
export function loadAllRuns(includeHeld = false): ArchiveScan {
  if (includeHeld) {
    const published = loadAllRuns();
    const held = scanRuns(path.join(REPO_ROOT, "data", "held"));
    return { runs: [...published.runs, ...held.runs].sort((a, b) => a.run_date.localeCompare(b.run_date)),
      errors: [...published.errors.map(e => `data/runs/${e}`), ...held.errors.map(e => `data/held/${e}`)] };
  }
  return scanRuns(RUNS_DIR);
}

function scanRuns(root: string): ArchiveScan {
  const runs: RunRecord[] = [];
  const errors: string[] = [];
  let dates: string[];
  try {
    dates = fs.readdirSync(root).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(".: archive directory is unreadable");
    return { runs, errors };
  }

  for (const date of dates) {
    const dir = path.join(root, date);
    let files: string[];
    try {
      if (!fs.statSync(dir).isDirectory()) {
        errors.push(`${date}: expected an archive directory`);
        continue;
      }
      files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
    } catch {
      errors.push(`${date}: archive directory is unreadable`);
      continue;
    }
    for (const file of files) {
      const where = `${date}/${file}`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      } catch {
        errors.push(`${where}: unreadable or not valid JSON`);
        continue;
      }
      if (!isRunRecord(parsed)) {
        errors.push(`${where}: not a well-formed run record`);
        continue;
      }
      if (parsed.run_date !== date || `${parsed.category}.json` !== file) {
        errors.push(`${where}: declares ${parsed.category}/${parsed.run_date}`);
        continue;
      }
      runs.push(parsed);
    }
  }
  return { runs, errors };
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
): Array<{ date: string; readingDate: string; rotation: number; firstShare: number; breakReason: string | null }> {
  return loadHistory(category).map((run, i, runs) => {
    const row = standings(run).find((s) => s.brand === brand);
    return {
      date: run.measured_on || run.run_date,
      readingDate: run.run_date,
      breakReason: i ? comparisonReason(run, runs[i - 1]) : null,
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
export function loadAffiliations(category: string, run?: RunRecord): Record<string, string[]> {
  let parsed = run?.methodology?.aliases;
  if (parsed == null) {
    const file = path.join(REPO_ROOT, "aliases", `${category}.yml`);
    if (!fs.existsSync(file)) return {};
    parsed = loadYaml(fs.readFileSync(file, "utf-8")) as typeof parsed;
  }
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

export type HeldRun = { category: string; date: string; errorRate: number | null; reasons: string[]; recoveredOn?: string };

/**
 * Runs that failed their checks and were withheld.
 *
 * These live in data/held and are deliberately not readable by any public page.
 * The operator still needs to see them, because a held week is the one thing
 * that needs a person: it is the pipeline saying it would rather print nothing
 * than print something wrong.
 */
export function loadHeld(): { runs: HeldRun[]; errors: string[] } {
  const dir = path.join(REPO_ROOT, "data", "held");
  const held = scanRuns(dir);
  const published = loadAllRuns();
  const key = (r: RunRecord) => `${r.run_date}/${r.category}`;
  const index = new Map<string, RunRecord | null>();
  for (const record of [...held.runs, ...published.runs]) {
    // Legacy paths present in both buckets cannot identify a unique source.
    index.set(key(record), index.has(key(record)) ? null : record);
  }
  const recoveries = new Map<string, string>();
  for (const reading of published.runs) {
    const ancestors: string[] = [];
    let cursor = reading;
    let valid = reading.publication_checks?.passed !== false;
    while (valid && cursor.source_run) {
      const parent = index.get(cursor.source_run);
      if (!parent || parent.category !== reading.category || parent.run_date >= cursor.run_date
        || (parent.measured_on || parent.run_date) !== (reading.measured_on || reading.run_date)) {
        valid = false;
        break;
      }
      ancestors.push(key(parent));
      cursor = parent;
    }
    if (valid) for (const ancestor of ancestors) {
      if ((recoveries.get(ancestor) ?? "") < reading.run_date) recoveries.set(ancestor, reading.run_date);
    }
  }
  const runs = held.runs.map((run): HeldRun => ({
    category: run.category,
    date: run.run_date,
    errorRate: run.extractions.length ? run.extractions.filter(e => e.error).length / run.extractions.length : null,
    reasons: Array.isArray(run.publication_checks?.reasons)
      ? run.publication_checks.reasons.filter((r): r is string => typeof r === "string" && !!r.trim()) : [],
    recoveredOn: recoveries.get(key(run)),
  }));
  return { runs: runs.sort((a, b) => b.date.localeCompare(a.date)),
    errors: [...held.errors.map(e => `data/held/${e}`), ...published.errors.map(e => `data/runs/${e}`)] };
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

export type QuarantineEntry = {
  name: string;
  count: number;
  /** Where it was seen. A name can appear in more than one category. */
  categories: string[];
  /**
   * Seen often enough, in at least one run, to have held that run.
   *
   * Decided here rather than by the page, because it is the only place that
   * still knows which run each count came from. The page applied one threshold
   * derived from the flagship category's latest published run to counts pooled
   * from every category -- so a name seen five times in a 279-answer run counted
   * as material against a floor of five, when its own run's floor is six. That
   * read 33 where the rule gives 24, and nine of the nine extras were the same
   * off-by-one.
   */
  material: boolean;
};

/** The share of a run's answered calls a name must reach to have held it. */
const QUARANTINE_MATERIAL = 0.02;

export function quarantineKey(name: string): string {
  const parts = name.trim().toLowerCase().replace(/['\u2019]s\b/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/);
  while (["llc", "inc", "incorporated", "ltd", "limited", "corp", "corporation", "co"].includes(parts.at(-1) ?? "")) parts.pop();
  return parts.join(" ");
}

/**
 * Unrecognised names from each live category's latest readable record.
 * Sidecars are written only for nonempty quarantine, so they cannot establish
 * whether a newer reading cleared it. Use the immutable source and its own
 * answered-call denominator. Frequency prioritizes review, not product identity.
 */
export function loadQuarantine(): { entries: QuarantineEntry[]; errors: string[] } {
  const archive = loadAllRuns(true);
  const errors = [...archive.errors];
  const found = new Map<string, { count: number; categories: Set<string>; material: boolean }>();

  for (const category of CATEGORIES) {
    const readings = archive.runs.filter(r => r.category === category.slug);
    const latest = readings.at(-1);
    if (!latest) continue;
    const where = `${latest.run_date}/${category.slug}`;
    if (readings.filter(r => r.run_date === latest.run_date).length !== 1) {
      errors.push(`${where}: ambiguous held/published identity`);
      continue;
    }
    const names = latest.quarantined;
    if (!Array.isArray(names) || names.some(n => typeof n !== "string" || !n.trim())) {
      errors.push(`${where}: quarantine names are missing or malformed`);
      continue;
    }
    const total = answered(latest).length;
    if (names.length && !total) {
      errors.push(`${where}: quarantine has no answered-call denominator`);
      continue;
    }
    const here = new Map<string, number>();
    for (const raw of names) {
      const key = quarantineKey(raw);
      if (key) here.set(key, (here.get(key) ?? 0) + 1);
    }
    for (const [name, count] of here) {
      const at = found.get(name) ?? { count: 0, categories: new Set<string>(), material: false };
      at.count += count;
      at.categories.add(category.slug);
      if (total && count / total >= QUARANTINE_MATERIAL) at.material = true;
      found.set(name, at);
    }
  }

  return { entries: [...found.entries()]
    .map(([name, at]) => ({ name, count: at.count, categories: [...at.categories].sort(), material: at.material }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)), errors };
}
