/**
 * Every number this publication reports, and nothing that reads a file.
 *
 * Split out of `lib/data.ts` so there is exactly one TypeScript implementation
 * of the metric and the agreement check can execute it.
 *
 * It could not before. `tests/agreement.test.mjs` carried its own copy of
 * `standings()` and asserted that copy against a fixture, which is a test of
 * the copy. Its comment claimed "if these diverge, the fixture catches it";
 * it did not, and could not, because nothing in the check ever imported the
 * module the site actually renders from. Both audits flagged three
 * implementations of one metric. This removes the third and points the test at
 * the second, so Python and the site are compared directly on real runs.
 *
 * The constraint that keeps that possible: **no imports with a relative path**
 * and no I/O. Node strips the types and runs this file directly, and an
 * extensionless relative import is the one thing that stops it. Anything
 * needing the filesystem belongs in `lib/data.ts`, which imports from here.
 */

export type BrandMention = { name: string; position: number; sentiment: string };

/**
 * What a provider said it used answering one question, in its own words.
 *
 * Optional throughout: runs archived before usage was instrumented carry none
 * of it, and the archive is append-only, so a missing measurement stays
 * missing rather than being backfilled with a guess.
 */
export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  web_searches?: number;
  requests?: number;
  /** The extraction pass rides on the same record but is billed separately. */
  extract_input_tokens?: number;
  extract_output_tokens?: number;
};

export type Extraction = {
  engine: string;
  question_id: string;
  run_index: number;
  brands: BrandMention[];
  sources: string[];
  refused: boolean;
  error: string | null;
  usage?: Usage;
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
  /**
   * The same steps as counts rather than shares: how many runs of that question
   * named this brand.
   *
   * Kept beside the share rather than derived from it, because a share cannot
   * be turned back into a count. The board's readout reconstructed one by
   * dividing the answered total by the number of questions, which is an average
   * and was wrong for every question on the published image run: it showed
   * "13/13" where fifteen runs had answered. A published figure has to come
   * from the thing it counts.
   */
  stepNamed: number[];
};

export type Movement = {
  brand: string;
  rotationDelta: number;
  firstShareDelta: number;
  isNew: boolean;
  isDropout: boolean;
  /**
   * Whether the rotation change is larger than this sample can explain by
   * chance. A move that is not significant is still reported as a number; it is
   * just not drawn as an arrow or named as a story. See `exceedsNoise`.
   */
  significant: boolean;
};

/** Extractions that produced a usable answer: no error, not a refusal. */

export function answered(run: RunRecord): Extraction[] {
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

export function questionOrder(run: RunRecord): string[] {
  const order: string[] = [];
  for (const ex of answered(run)) {
    if (ex.question_id && !order.includes(ex.question_id)) order.push(ex.question_id);
  }
  return order;
}

/** Question id -> the exact wording asked, from the published question bank. */

export function answeredPerQuestion(run: RunRecord): number[] {
  const answers = answered(run);
  const counts = new Map<string, number>();
  for (const ex of answers) {
    counts.set(ex.question_id, (counts.get(ex.question_id) ?? 0) + 1);
  }
  return questionOrder(run).map((qid) => counts.get(qid) ?? 0);
}

export function standings(run: RunRecord): BrandStanding[] {
  const answers = answered(run);
  const total = answers.length;
  if (total === 0) return [];

  const names = new Set<string>();
  for (const ex of answers) for (const b of ex.brands) names.add(b.name);

  const order = questionOrder(run);
  // Indexed once. The per-question loop below used to re-filter every answer
  // for every brand, which is answers x questions x brands and grows with the
  // cube of a category.
  const byQuestion = new Map<string, Extraction[]>();
  for (const ex of answers) {
    const bucket = byQuestion.get(ex.question_id);
    if (bucket) bucket.push(ex);
    else byQuestion.set(ex.question_id, [ex]);
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

    const stepNamed = order.map((qid) => {
      const forQ = byQuestion.get(qid);
      if (!forQ?.length) return 0;
      return forQ.filter((e) => e.brands.some((b) => b.name === name)).length;
    });
    const steps = order.map((qid, i) => {
      const forQ = byQuestion.get(qid);
      if (!forQ?.length) return 0;
      return Math.round((stepNamed[i] / forQ.length) * 10000) / 10000;
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
      stepNamed,
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Is this week-over-week change bigger than the noise in the sample?
 *
 * Fifteen questions asked five times across a handful of engines is a small
 * sample, and a proportion drawn from one wobbles. At 225 answered runs a share
 * near 30% carries a 95% interval of roughly six points, so a brand "moving"
 * four points between Mondays has, more likely than not, not moved at all.
 *
 * This publication's whole claim is that its figures are measurements rather
 * than impressions. Drawing an arrow on a difference the sample cannot support
 * -- or worse, naming a brand The Snub over one -- would be the most damaging
 * thing it could print, because it would be indistinguishable from the guessing
 * it exists to replace.
 *
 * The usual two-proportion test: a difference counts when it exceeds 1.96
 * standard errors of that difference. Deliberately not a claim of statistical
 * rigour beyond that -- repeats within a week are not independent draws, so
 * treat this as a floor under what gets reported, not a p-value.
 */
export function exceedsNoise(
  p1: number,
  n1: number,
  p2: number,
  n2: number,
): boolean {
  if (n1 < 1 || n2 < 1) return false;
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  if (se === 0) return p1 !== p2;
  return Math.abs(p1 - p2) / se > 1.96;
}

/** The 95% half-interval on a proportion, in percentage points. */
export function marginOfError(p: number, n: number): number {
  if (n < 1) return 0;
  return round1(1.96 * Math.sqrt((p * (1 - p)) / n) * 100);
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
      significant: before
        ? exceedsNoise(now.rotation, now.totalRuns, before.rotation, before.totalRuns)
        : false,
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
        // Named last week and not once this week is a real disappearance, not a
        // wobble, so it always counts.
        significant: true,
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
/**
 * The week's biggest faller, or nobody.
 *
 * A dropout always outranks a decline, and a decline the sample cannot support
 * is not a story. Naming a brand The Snub over a four-point wobble on 225 runs
 * would be exactly the kind of manufactured drama this publication exists to
 * replace, and the one a reader could most easily check and disprove.
 */
export function theSnub(moves: Movement[]): Movement | null {
  if (!moves.length) return null;
  const dropouts = moves.filter((m) => m.isDropout);
  if (dropouts.length) return dropouts[0];
  const worst = moves[0];
  return worst.rotationDelta < 0 && worst.significant ? worst : null;
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


/* -- what a run cost, and how its engines behaved -------------------------- */

/**
 * Rates as data/rates.json holds them. Passed in rather than imported so this
 * file keeps its one rule -- no I/O, no relative imports -- which is what lets
 * `node --experimental-strip-types` run it directly in the agreement test.
 */
export type Rates = {
  batch_discount: number;
  /** Registry ids whose extraction is billed through the Batch API, at half price. */
  batch_billed_extractors: string[];
  verified: string;
  engines: Record<string, { input_per_m: number; output_per_m: number; per_search: number }>;
};

/**
 * Did this run's extraction go through the Batch API, and so at half price?
 *
 * A run names the registry id of the extractor that read it. Both this and
 * cost.py tested the literal string "api" until 2026-08-26, which the pipeline
 * stopped writing when it began recording real provenance. The failure was
 * silent and in the expensive direction: every hosted run would have priced its
 * extraction at double, on a dashboard built to answer what a week cost.
 *
 * No archived run has ever used the hosted path, so no test executed this
 * branch. The agreement suite now carries a synthetic run that does, and asserts
 * the half-price figure rather than only that the two languages match -- two
 * implementations of one wrong rule agree perfectly.
 */
export function batchBilled(extractor: string | undefined, rates: Rates): boolean {
  return Boolean(extractor) && rates.batch_billed_extractors.includes(extractor as string);
}

export type LineItem = {
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  dollars: number;
};

function price(
  rates: Rates,
  engine: string,
  usage: { input_tokens?: number; output_tokens?: number; web_searches?: number; requests?: number },
): number {
  const rate = rates.engines[engine];
  if (!rate) return 0;
  const searches = usage.web_searches || usage.requests || 0;
  return (
    ((usage.input_tokens ?? 0) / 1_000_000) * rate.input_per_m +
    ((usage.output_tokens ?? 0) / 1_000_000) * rate.output_per_m +
    searches * rate.per_search
  );
}

/**
 * Per-engine line items plus the total, from reported usage only.
 *
 * The TypeScript half of src/unprompted/cost.py. Both read data/rates.json, and
 * tests/agreement.test.mjs prices every archived run through both and refuses a
 * disagreement, because a dashboard that quotes a different number than the
 * terminal is worse than a dashboard with no number on it.
 *
 * A run recorded before usage was instrumented prices at zero rather than a
 * guess. A missing measurement should look missing.
 */
export function costOfRun(run: RunRecord, rates: Rates): { items: LineItem[]; total: number } {
  const buckets = new Map<string, LineItem>();
  const extractRate = batchBilled(run.extractor, rates) ? rates.batch_discount : 1;

  const bucket = (key: string, label: string): LineItem => {
    let item = buckets.get(key);
    if (!item) {
      item = { label, calls: 0, inputTokens: 0, outputTokens: 0, searches: 0, dollars: 0 };
      buckets.set(key, item);
    }
    return item;
  };

  for (const ex of run.extractions) {
    const engine = ex.engine || "unknown";
    const usage = ex.usage ?? {};
    const item = bucket(engine, engine);
    item.calls += 1;
    item.inputTokens += usage.input_tokens ?? 0;
    item.outputTokens += usage.output_tokens ?? 0;
    item.searches += usage.web_searches || usage.requests || 0;
    item.dollars += price(rates, engine, usage);

    const ein = usage.extract_input_tokens ?? 0;
    const eout = usage.extract_output_tokens ?? 0;
    if (ein || eout) {
      const ei = bucket("_extract", "extract");
      ei.calls += 1;
      ei.inputTokens += ein;
      ei.outputTokens += eout;
      ei.dollars +=
        extractRate * price(rates, "_extract", { input_tokens: ein, output_tokens: eout });
    }
  }

  const items = [...buckets.values()].sort((a, b) => b.dollars - a.dollars);
  const total = items.reduce((sum, i) => sum + i.dollars, 0);
  /*
    Four places -- cents would hide the per-answer figure, which is the number
    that says whether a method change is affordable.

    cost.py spells this as floor(x + 0.5), which is exactly what Math.round does
    here, because Python's round() takes halves to even and this one takes them
    up: $0.03125 came to $0.0312 in the terminal and $0.0313 on the dashboard.
    No archived run lands on a tie, so the agreement suite passed while the two
    rules differed. It carries a tie fixture now.
  */
  return { items, total: Math.round(total * 10_000) / 10_000 };
}

/**
 * How each engine behaved, measured the way the rule that holds a week measures.
 *
 * checks.py rule 5 evaluates every category independently and stops the whole
 * run when any single engine is over the limit in any single category. This was
 * pooling every category of a run date before dividing, which is a different
 * measurement wearing the same name: an engine failing 25% in one category and
 * 0% in an equally sized other reported 12.5% and looked fine, while the check
 * would have refused to publish. Averaging a breach away is the exact failure
 * this panel exists to prevent, so the rate shown is the worst category's, and
 * the category is named alongside it.
 *
 * Totals stay pooled -- answered and failed are real counts across the run, and
 * the operator is reconciling a whole week. Only the rate and the verdict come
 * from the worst category, because those are the numbers that decide something.
 */
export const MAX_ENGINE_ERROR_RATE = 0.2;

export type EngineHealth = {
  engine: string;
  /** Calls and failures across every category measured, for the week's totals. */
  calls: number;
  errors: number;
  /** The worst single category's failure rate -- the one the check would judge. */
  rate: number;
  /** Which category that rate came from, so the number can be chased. */
  worstCategory: string | null;
  /** Over the limit in at least one category, and so a run the check would hold. */
  over: boolean;
};

export function engineHealth(runs: RunRecord[]): EngineHealth[] {
  type Tally = { calls: number; errors: number; byCategory: Map<string, [number, number]> };
  const tallies = new Map<string, Tally>();

  for (const run of runs) {
    for (const ex of run.extractions) {
      const engine = ex.engine || "unknown";
      let t = tallies.get(engine);
      if (!t) {
        t = { calls: 0, errors: 0, byCategory: new Map() };
        tallies.set(engine, t);
      }
      t.calls += 1;
      if (ex.error) t.errors += 1;

      const cat = run.category || "unknown";
      const pair = t.byCategory.get(cat) ?? [0, 0];
      pair[0] += 1;
      if (ex.error) pair[1] += 1;
      t.byCategory.set(cat, pair);
    }
  }

  return [...tallies.entries()]
    .map(([engine, t]) => {
      let rate = 0;
      let worstCategory: string | null = null;
      for (const [cat, [calls, errors]] of t.byCategory) {
        const r = calls ? errors / calls : 0;
        if (worstCategory === null || r > rate) {
          rate = r;
          worstCategory = cat;
        }
      }
      return {
        engine,
        calls: t.calls,
        errors: t.errors,
        rate,
        worstCategory,
        over: rate > MAX_ENGINE_ERROR_RATE,
      };
    })
    .sort((a, b) => b.rate - a.rate || a.engine.localeCompare(b.engine));
}


/* -- what a week actually covered ------------------------------------------ */

export type EngineCoverage = {
  engine: string;
  /** Calls that produced an answer the board could read. */
  answered: number;
  /** Calls made. Errors and refusals are the difference. */
  attempted: number;
  short: boolean;
};

/**
 * How much of a week each engine actually answered.
 *
 * The chart says "N runs each across M engines", and for most weeks that is
 * true. For the week of 2026-08-24 it was not: Claude hit a provider spend cap
 * partway through and answered 51 of its 75 calls, and the page went on
 * claiming three engines at five runs a question. The comment above that
 * sentence in chart-board.tsx says it has to match what the board draws, and it
 * had stopped matching.
 *
 * No percentage on the site was wrong -- `standings()` divides by `answered()`,
 * so a call that failed is excluded rather than counted as "this brand was not
 * named". The claim about the sample was wrong, which on a site whose entire
 * proposition is "check my work" is the more serious of the two.
 *
 * Computed rather than annotated, so it is right for every future week without
 * anybody remembering to write a note.
 */
export function coverage(run: RunRecord): EngineCoverage[] {
  const attempted = new Map<string, number>();
  const ok = new Map<string, number>();

  for (const ex of run.extractions) {
    const engine = ex.engine || "unknown";
    attempted.set(engine, (attempted.get(engine) ?? 0) + 1);
    if (!ex.error && !ex.refused) ok.set(engine, (ok.get(engine) ?? 0) + 1);
  }

  return [...attempted.entries()]
    .map(([engine, n]) => ({
      engine,
      answered: ok.get(engine) ?? 0,
      attempted: n,
      short: (ok.get(engine) ?? 0) < n,
    }))
    .sort((a, b) => a.answered - b.answered || a.engine.localeCompare(b.engine));
}

/** The engines that did not answer everything they were asked, worst first. */
export function shortfall(run: RunRecord): EngineCoverage[] {
  return coverage(run).filter((c) => c.short);
}
