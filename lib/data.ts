/**
 * Reads the pipeline's output at build time.
 *
 * The Python side owns `data/runs/`. This side only ever reads it. There is no
 * database and no API between them: the repository is the interface, which is
 * what makes the archive publicly verifiable.
 */

import fs from "node:fs";
import path from "node:path";

import { getCategory as getCategoryFromRegistry } from "./categories";

export const REPO_ROOT = process.cwd();
const RUNS_DIR = path.join(REPO_ROOT, "data", "runs");

export type BrandMention = { name: string; position: number; sentiment: string };

export type Extraction = {
  engine: string;
  question_id: string;
  run_index: number;
  brands: BrandMention[];
  sources: string[];
  refused: boolean;
  error: string | null;
};

export type RunRecord = {
  category: string;
  run_date: string;
  method_version: number;
  runs_per_question: number;
  engines: string[];
  extractions: Extraction[];
  quarantined: string[];
};

export type BrandStanding = {
  brand: string;
  named: number;
  totalRuns: number;
  rotation: number;
  firstNamed: number;
  firstShare: number;
  medianPosition: number | null;
  cells: boolean[];
  /**
   * One step per question, 0..1 by how often this brand was named for it.
   * A step sequencer already has this idea: it is velocity. One cell per run
   * put 225 cells in a row and overflowed the page; 15 steps with intensity
   * reads at a glance and shows *which* questions a brand wins.
   */
  steps: number[];
};

export type Movement = {
  brand: string;
  rotationDelta: number;
  firstShareDelta: number;
  isNew: boolean;
  isDropout: boolean;
};

/** Extractions that produced a usable answer: no error, not a refusal. */
function answered(run: RunRecord): Extraction[] {
  return run.extractions.filter((e) => !e.error && !e.refused);
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
    if (fs.existsSync(file)) {
      runs.push(JSON.parse(fs.readFileSync(file, "utf-8")) as RunRecord);
    }
  }
  return runs;
}

export function latestRun(category: string): RunRecord | null {
  const history = loadHistory(category);
  return history.length ? history[history.length - 1] : null;
}

/**
 * Standings for one run.
 *
 * Ordered by first-named share ahead of rotation. In a field of five or six the
 * leader's rotation pins near 100% and stops moving, so ordering on rotation
 * alone would freeze the board. First-named share keeps discriminating.
 */
export function standings(run: RunRecord): BrandStanding[] {
  const answers = answered(run);
  const total = answers.length;
  if (total === 0) return [];

  const names = new Set<string>();
  for (const ex of answers) for (const b of ex.brands) names.add(b.name);

  // Question order follows first appearance, so steps line up with the
  // published question bank rather than sorting alphabetically.
  const questionOrder: string[] = [];
  for (const ex of answers) {
    if (ex.question_id && !questionOrder.includes(ex.question_id)) {
      questionOrder.push(ex.question_id);
    }
  }

  const out: BrandStanding[] = [];
  for (const name of names) {
    const cells: boolean[] = [];
    const positions: number[] = [];
    let firstNamed = 0;

    for (const ex of answers) {
      const hit = ex.brands.find((b) => b.name === name);
      cells.push(Boolean(hit));
      if (hit) {
        positions.push(hit.position);
        if (hit.position === 1) firstNamed += 1;
      }
    }

    const named = cells.filter(Boolean).length;
    positions.sort((a, b) => a - b);
    const mid = Math.floor(positions.length / 2);
    const medianPosition = positions.length
      ? positions.length % 2
        ? positions[mid]
        : (positions[mid - 1] + positions[mid]) / 2
      : null;

    const steps = questionOrder.map((qid) => {
      const forQ = answers.filter((e) => e.question_id === qid);
      if (!forQ.length) return 0;
      const hits = forQ.filter((e) => e.brands.some((b) => b.name === name)).length;
      return Math.round((hits / forQ.length) * 10000) / 10000;
    });

    out.push({
      brand: name,
      named,
      totalRuns: total,
      rotation: named / total,
      firstNamed,
      firstShare: firstNamed / total,
      medianPosition,
      cells,
      steps,
    });
  }

  out.sort(
    (a, b) =>
      b.firstShare - a.firstShare ||
      b.rotation - a.rotation ||
      a.brand.localeCompare(b.brand),
  );
  return out;
}

export function movement(
  thisWeek: BrandStanding[],
  lastWeek: BrandStanding[],
): Movement[] {
  const prev = new Map(lastWeek.map((b) => [b.brand, b]));
  const curr = new Map(thisWeek.map((b) => [b.brand, b]));
  const moves: Movement[] = [];

  for (const [brand, now] of curr) {
    const before = prev.get(brand);
    moves.push({
      brand,
      rotationDelta: round1((now.rotation - (before?.rotation ?? 0)) * 100),
      firstShareDelta: round1((now.firstShare - (before?.firstShare ?? 0)) * 100),
      isNew: !before,
      isDropout: false,
    });
  }

  for (const [brand, before] of prev) {
    if (!curr.has(brand)) {
      moves.push({
        brand,
        rotationDelta: round1(-before.rotation * 100),
        firstShareDelta: round1(-before.firstShare * 100),
        isNew: false,
        isDropout: true,
      });
    }
  }

  moves.sort((a, b) => a.rotationDelta - b.rotationDelta);
  return moves;
}

/**
 * The week's biggest faller. A dropout always outranks a decline.
 * Returns null on a quiet week: inventing drama is how a chart loses trust.
 */
export function theSnub(moves: Movement[]): Movement | null {
  if (!moves.length) return null;
  const dropouts = moves.filter((m) => m.isDropout);
  if (dropouts.length) return dropouts[0];
  const worst = moves[0];
  return worst.rotationDelta < 0 ? worst : null;
}

export function sourceCounts(run: RunRecord): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const ex of answered(run)) {
    for (const url of ex.sources) {
      let host = "";
      try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        continue;
      }
      if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Rotation across every recorded week, for a brand's history chart. */
export function brandHistory(
  category: string,
  brand: string,
): Array<{ date: string; rotation: number; firstShare: number }> {
  return loadHistory(category)
    .map((run) => {
      const row = standings(run).find((s) => s.brand === brand);
      return row
        ? { date: run.run_date, rotation: row.rotation, firstShare: row.firstShare }
        : null;
    })
    .filter((x): x is { date: string; rotation: number; firstShare: number } => x !== null);
}

export function allBrands(category: string): string[] {
  const names = new Set<string>();
  for (const run of loadHistory(category)) {
    for (const s of standings(run)) names.add(s.brand);
  }
  return [...names].sort();
}

export function slugify(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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

/** Plain-text form, for places that cannot carry a link (feeds, meta tags). */
export const DISCLOSURE =
  "Operated by Skald Studio, which sells AI visibility work. No placement on this chart is for sale.";

export const OPERATOR = "Skald Studio";
export const OPERATOR_URL = "https://skaldstudio.io";


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

export function loadAffiliations(category: string): Record<string, string> {
  const file = path.join(REPO_ROOT, "aliases", `${category}.yml`);
  if (!fs.existsSync(file)) return {};
  // Deliberately a tiny reader rather than a YAML dependency: the block is a
  // flat "Brand: engine" map and nothing more.
  const text = fs.readFileSync(file, "utf-8");
  // Matched with a multiline regex rather than split on newlines, so the
  // reader is indifferent to CRLF and never carries a literal newline.
  const block = /^affiliations:[ \t]*$([\s\S]*?)(?=^\S)/m.exec(text);
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/^[ \t]+(.+?):[ \t]*(\S+)[ \t]*$/gm)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

export function selfPreference(
  run: RunRecord,
  affiliations: Record<string, string>,
): SelfPreference[] {
  const answers = run.extractions.filter((e) => !e.error && !e.refused);
  const out: SelfPreference[] = [];

  for (const [brand, owner] of Object.entries(affiliations)) {
    const own = answers.filter((e) => e.engine === owner);
    const rival = answers.filter((e) => e.engine !== owner);
    if (!own.length || !rival.length) continue;

    const namedIn = (rows: Extraction[]) =>
      rows.filter((e) => e.brands.some((b) => b.name === brand)).length;

    const ownNamed = namedIn(own);
    const rivalNamed = namedIn(rival);
    const ownRate = ownNamed / own.length;
    const rivalRate = rivalNamed / rival.length;

    out.push({
      brand,
      engine: owner,
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
