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
  /**
   * Which reader turned the answers into structured data. Optional because runs
   * archived before the field existed do not carry it, and the archive is
   * append-only, so those files are never backfilled.
   */
  extractor?: string;
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

/**
 * Is this parsed JSON actually a run record?
 *
 * `as RunRecord` is an assertion, not a check: it tells the compiler to stop
 * asking and does nothing at runtime. Every number on the site is derived from
 * these files, so a truncated write or a hand edit would either crash the build
 * or, worse, produce a board computed from a partial record. The shape is small
 * and fixed, so this is a guard rather than a schema dependency.
 */
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
export function questionOrder(run: RunRecord): string[] {
  const order: string[] = [];
  for (const ex of answered(run)) {
    if (ex.question_id && !order.includes(ex.question_id)) order.push(ex.question_id);
  }
  return order;
}

/** Question id -> the exact wording asked, from the published question bank. */
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
export function standings(run: RunRecord): BrandStanding[] {
  const answers = answered(run);
  const total = answers.length;
  if (total === 0) return [];

  const names = new Set<string>();
  for (const ex of answers) for (const b of ex.brands) names.add(b.name);

  const order = questionOrder(run);

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

    const steps = order.map((qid) => {
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

/**
 * Rotation across every recorded week, for a brand's history chart.
 *
 * A week the brand was not named is a zero, not a gap. Dropping those rows made
 * the sparkline join two non-adjacent weeks with a straight line — drawing a
 * gentle decline over what was actually a fall to nothing and back — and made
 * "Weeks tracked" count appearances rather than weeks.
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

export type EnginePick = {
  engine: string;
  /** The brand this engine named first most often. Null if it named none. */
  brand: string | null;
  /** That brand's share of this engine's answers to this question. */
  share: number;
};

export type QuestionConsensus = {
  questionId: string;
  text: string;
  picks: EnginePick[];
  /** The brand the most engines picked, null when nothing was named at all. */
  majority: string | null;
  /** How many engines picked the majority brand. */
  agree: number;
  /** Every engine picked the same brand. */
  settled: boolean;
};

/**
 * Which brand each engine puts first, question by question.
 *
 * The finding this surfaces is that the engines frequently disagree: asked what
 * the best AI coding assistant is, one names Copilot, one names Claude Code and
 * one names Cursor. A chart of "what AI recommends" is incomplete without
 * saying *which* AI, and no competing tool publishes the split.
 *
 * An engine's pick is the brand it named first most often across its repeats,
 * not across a single answer, because a single answer is noise: these systems
 * do not give the same answer twice, which is why the method asks repeatedly.
 */
export function consensus(
  run: RunRecord,
  questionText: Record<string, string>,
): QuestionConsensus[] {
  const rows = answered(run);
  const engines = [...new Set(rows.map((e) => e.engine))].sort();

  return questionOrder(run).map((questionId) => {
    const picks: EnginePick[] = engines.map((engine) => {
      const forEngine = rows.filter(
        (e) => e.question_id === questionId && e.engine === engine,
      );
      const firsts = new Map<string, number>();
      for (const ex of forEngine) {
        const first = ex.brands.find((b) => b.position === 1);
        if (first) firsts.set(first.name, (firsts.get(first.name) ?? 0) + 1);
      }
      // Ties break alphabetically so the page is stable between builds rather
      // than depending on Map insertion order.
      const ranked = [...firsts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      );
      const [brand, count] = ranked[0] ?? [null, 0];
      return {
        engine,
        brand,
        share: forEngine.length ? count / forEngine.length : 0,
      };
    });

    const votes = new Map<string, number>();
    for (const p of picks) {
      if (p.brand) votes.set(p.brand, (votes.get(p.brand) ?? 0) + 1);
    }
    const ranked = [...votes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const [majority, agree] = ranked[0] ?? [null, 0];

    return {
      questionId,
      text: questionText[questionId] ?? questionId,
      picks,
      majority,
      agree,
      // Settled means unanimous, and only counts when every engine actually
      // named something: three engines naming nothing is not agreement.
      settled: agree === picks.length && picks.every((p) => p.brand !== null),
    };
  });
}

/** Share of questions on which every engine named the same brand first. */
export function consensusScore(rows: QuestionConsensus[]): {
  settled: number;
  total: number;
  share: number;
} {
  const settled = rows.filter((r) => r.settled).length;
  return { settled, total: rows.length, share: rows.length ? settled / rows.length : 0 };
}

/**
 * How often each engine's pick differs from what the other engines chose.
 *
 * Reported per engine rather than as a single "odd one out", because on a
 * three-engine panel the outlier changes from question to question and naming
 * one engine the contrarian overall would be a claim the data does not support.
 */
export function engineDivergence(
  rows: QuestionConsensus[],
): Array<{ engine: string; differs: number; of: number }> {
  const counts = new Map<string, { differs: number; of: number }>();
  for (const row of rows) {
    for (const pick of row.picks) {
      const entry = counts.get(pick.engine) ?? { differs: 0, of: 0 };
      entry.of += 1;
      if (row.majority && pick.brand !== row.majority) entry.differs += 1;
      counts.set(pick.engine, entry);
    }
  }
  return [...counts.entries()]
    .map(([engine, v]) => ({ engine, ...v }))
    .sort((a, b) => b.differs - a.differs || a.engine.localeCompare(b.engine));
}

/* -- tone ----------------------------------------------------------------- */

export type Tone = { positive: number; neutral: number; negative: number; total: number };

/**
 * How a brand is spoken about, not merely how often it is named.
 *
 * Recorded on every mention since the first run and never surfaced until now.
 * Two brands can share a rotation figure and be treated completely differently:
 * one recommended, the other listed and passed over.
 *
 * Second-order evidence, and labelled as such wherever it is shown. The
 * sentiment is the extraction model's reading of the answer, not the engine's
 * own statement, so it is softer than a name count and must never be presented
 * with the same confidence.
 */
export function brandTone(run: RunRecord, brand: string): Tone | null {
  const tone: Tone = { positive: 0, neutral: 0, negative: 0, total: 0 };
  for (const ex of answered(run)) {
    for (const mention of ex.brands) {
      if (mention.name !== brand) continue;
      tone.total += 1;
      if (mention.sentiment === "positive") tone.positive += 1;
      else if (mention.sentiment === "negative") tone.negative += 1;
      else tone.neutral += 1;
    }
  }
  return tone.total ? tone : null;
}

export function allBrands(category: string): string[] {
  const names = new Set<string>();
  for (const run of loadHistory(category)) {
    for (const s of standings(run)) names.add(s.brand);
  }
  return [...names].sort();
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
