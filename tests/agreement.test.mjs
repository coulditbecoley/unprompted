/**
 * Do the two implementations of the metric still agree?
 *
 * Rotation is computed twice: in Python for the sanity checks that decide
 * whether a week publishes, and in TypeScript for the site that renders it. Two
 * implementations of one number drift silently, and a chart that disagrees with
 * its own gate is the failure this project can least afford.
 *
 * This check used to carry a *third* copy of `standings()` and assert that copy
 * against a fixture, which is a test of the copy. Its comment claimed "if these
 * diverge, the fixture catches it"; it could not, because nothing here ever
 * imported the module the site renders from. Both audits flagged the three
 * implementations. There are two now, and this executes one of them.
 *
 * It runs the production TypeScript directly -- Node strips the types -- and
 * shells out to the production Python, over every run in the public archive
 * rather than over a sample. A metric that agrees on a fixture and disagrees on
 * a published week has failed at the only moment that mattered.
 *
 * Run with: node --test tests/agreement.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveSessionToken, validSession, isAuthorised } from "../lib/auth.ts";

test("admin sessions expire and reject tampering", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await deriveSessionToken("test-secret", now + 60);
  assert.equal(await validSession(token, "test-secret", now), true);
  assert.equal(await validSession(token, "test-secret", now + 60), false);
  assert.equal(await validSession(token, "wrong-secret", now), false);
  assert.equal(await validSession(`0${token}`, "test-secret", now), false);
  const prior = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = "test-secret";
  try {
    assert.equal(await isAuthorised(new Request("http://localhost/admin", {
      headers: { cookie: `other=value; unprompted_admin=${token}` },
    })), true);
  } finally {
    if (prior === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = prior;
  }
});

import {
  MAX_ENGINE_ERROR_RATE,
  batchBilled,
  costOfRun,
  engineHealth,
  shortfall,
  exceedsNoise,
  marginOfError,
  standings,
  consensus,
  engineDivergence,
  comparisonReason,
  movement,
  theSnub,
} from "../lib/metrics.ts";

test("ties, missing engines and pluralities cannot manufacture consensus", () => {
  const row = (engine, brand, index = 0) => ({ engine, question_id: "q1", run_index: index,
    brands: [{ name: brand, position: 1 }], sources: [], refused: false, error: null });
  const run = { category: "test", run_date: "2026-09-14", engines: ["a", "b", "c"], runs_per_question: 2,
    extractions: [row("a", "Alpha"), row("b", "Beta"), row("c", "Gamma")] };
  let rows = consensus(run, {});
  assert.equal(rows[0].majority, null);
  assert.ok(engineDivergence(rows).every(e => e.differs === 0));
  run.extractions = [row("a", "Alpha"), row("a", "Beta", 1), row("b", "Alpha"), row("b", "Beta", 1)];
  rows = consensus(run, {});
  assert.equal(rows[0].settled, false);
  assert.equal(rows[0].picks.length, 3);
  assert.ok(rows[0].picks.every(p => p.brand === null));
  run.extractions = [row("a", "Alpha"), row("b", "Alpha")];
  assert.equal(consensus(run, {})[0].settled, false);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const RUNS = path.join(REPO, "data", "runs");

/**
 * The interpreter, whatever it is called here.
 *
 * Windows installs `python`, the CI runner installs `python3`, and picking
 * either one would have made this pass on a laptop and fail on a build. The
 * checks module imports the YAML normalizer too, so CI installs the project's
 * pinned Python requirements before running these cross-language checks.
 */
const PYTHON = (() => {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
})();

/** Every published run, so the check is over real data and not a sample. */
test("Python and TypeScript refuse the same incompatible comparisons", { skip: !PYTHON }, () => {
  const previous = { category: "alpha", run_date: "2026-09-01", method_version: 1,
    runs_per_question: 1, engines: ["a", "b"], extractor: "reader", extractor_model: "model",
    extractions: [{ question_id: "q1" }], methodology: { aliases: { canonical: { A: ["a"], B: ["b"] } } } };
  const current = { ...structuredClone(previous), run_date: "2026-09-14" };
  const cases = [[current, previous, true], [current, null, false]];
  for (const edit of [
    { method_version: 2 }, { category: "beta" }, { engines: ["a"] },
    { runs_per_question: 2 }, { measured_on: "2026-09-01" },
    { extractions: [{ question_id: "q2" }] }, { extractor_model: "other" },
    { methodology: { aliases: { canonical: { Changed: [] } } } }, { method_version: null },
  ]) cases.push([{ ...current, ...edit }, previous, false]);
  cases.push([{ ...current, engines: ["b", "a"], methodology: {
    aliases: { canonical: { B: ["b"], A: ["a"] } },
  } }, previous, true]);
  const reasons = cases.map(([now, old, allowed]) => {
    const reason = comparisonReason(now, old);
    assert.equal(reason === null, allowed);
    return reason;
  });
  const script = ["import sys,json", SRC_PATH_LINE,
    "from unprompted.aggregate import comparison_reason",
    "print(json.dumps([comparison_reason(a,b) for a,b,_ in json.load(sys.stdin)]))"].join(NEWLINE);
  assert.deepEqual(JSON.parse(execFileSync(PYTHON, ["-c", script], {
    input: JSON.stringify(cases), encoding: "utf8", cwd: REPO,
  })), reasons);
});

test("a dropout without sufficient observations does not become a headline", () => {
  const row = (brand, totalRuns) => ({ brand, rotation: 1, firstShare: 1, totalRuns });
  assert.equal(theSnub(movement([row("B", 10)], [row("A", 10)])), null);
  assert.equal(theSnub(movement([row("B", 100)], [row("A", 100)])).brand, "A");
});

function publishedRuns() {
  if (!fs.existsSync(RUNS)) return [];
  return fs
    .readdirSync(RUNS)
    .flatMap((date) => {
      const dir = path.join(RUNS, date);
      if (!fs.statSync(dir).isDirectory()) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ label: `${date}/${f}`, file: path.join(dir, f) }));
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The same standings, from the Python the weekly checks actually use.
 *
 * Field names differ between the two -- `total_runs` against `totalRuns` --
 * because each is idiomatic in its own language. Only the numbers are compared,
 * which is the thing that must not drift.
 *
 * Ratios are compared at four decimal places, because that is where Python
 * stores them: `BrandWeek` rounds on construction and the site does not. The
 * counts they are derived from -- named, answered, first-named -- are compared
 * exactly, and those are the measurement. Comparing the ratios at full
 * precision would fail on every run over a difference of rounding rather than
 * of meaning, which is a check that cries wolf until somebody deletes it.
 */
const RATIO_DP = 4;
/** The line separator for a script assembled as an array of source lines. */
const NEWLINE = String.fromCharCode(10);
const ratio = (n) => Number(n.toFixed(RATIO_DP));
function pythonRun(file) {
  const script = [
    "import json, sys",
    SRC_PATH_LINE,
    "from unprompted.aggregate import brand_week",
    "from unprompted.cost import cost_of_run",
    "run = json.load(open(sys.argv[1], encoding='utf-8'))",
    "board = [[b.brand, b.named, b.total_runs, b.first_named,",
    `          round(b.rotation, ${RATIO_DP}), round(b.first_share, ${RATIO_DP}),`,
    `          [round(s, ${RATIO_DP}) for s in b.steps]] for b in brand_week(run)]`,
    "items, total = cost_of_run(run)",
    "cost = [[i.label, i.calls, i.input_tokens, i.output_tokens, i.searches,",
    "         round(i.dollars, 6)] for i in items]",
    "print(json.dumps({'board': board, 'cost': cost, 'total': total}))",
  ].join(NEWLINE);
  return JSON.parse(
    execFileSync(PYTHON, ["-c", script, file], { encoding: "utf-8" }),
  );
}

/** The one line that puts the package on Python's path, shared by both calls. */
const SRC_PATH_LINE =
  "sys.path.insert(0, r'''" + path.join(REPO, "src") + "''')";

/**
 * The significance rule, on inputs no published run happens to contain.
 *
 * It decides whether the board draws an arrow and whether a brand is named The
 * Snub, so the two languages disagreeing here would mean the site telling a
 * story the checks do not believe. The cases include the one that matters most:
 * a large-looking swing on a small sample, which must not count.
 */
const NOISE_CASES = [
  [0.3, 225, 0.26, 225],
  [0.3, 225, 0.2, 225],
  [0.3, 225, 0.15, 225],
  [0.5, 15, 0.3, 15],
  [0.3, 225, 0.3, 225],
  [0.0, 225, 0.05, 225],
  [1.0, 15, 1.0, 15],
];

test("Python and TypeScript agree on what counts as movement", () => {
  assert.ok(PYTHON, "no python interpreter found");
  const script = [
    "import sys, json",
    SRC_PATH_LINE,
    "from unprompted.aggregate import exceeds_noise, margin_of_error",
    "cases = json.loads(sys.argv[1])",
    "print(json.dumps([[exceeds_noise(*c), margin_of_error(c[0], c[1])] for c in cases]))",
  ].join("\n");
  const theirs = JSON.parse(
    execFileSync(PYTHON, ["-c", script, JSON.stringify(NOISE_CASES)], {
      encoding: "utf-8",
    }),
  );
  const ours = NOISE_CASES.map(([p1, n1, p2, n2]) => [
    exceedsNoise(p1, n1, p2, n2),
    marginOfError(p1, n1),
  ]);
  assert.deepEqual(ours, theirs, "the significance rule has drifted");
});


/**
 * The Batch discount, on a run the archive does not contain.
 *
 * Every check above is a cross-language comparison, which is exactly the shape
 * that cannot catch a rule both languages get wrong the same way -- and one did.
 * The discount was keyed to `extractor === "api"`, a string the pipeline stopped
 * writing when it began recording the real registry id, so a hosted run would
 * have priced its extraction at double. Both implementations agreed perfectly
 * about it, and no archived run has ever taken the hosted path, so seven passing
 * tests said nothing at all.
 *
 * This asserts the arithmetic against a figure worked out by hand, which is the
 * only kind of check that would have failed.
 */
test("a Batch-billed run prices its extraction at half", () => {
  const M = 1_000_000;
  const run = {
    category: "synthetic",
    run_date: "2026-01-01",
    method_version: 1,
    runs_per_question: 1,
    engines: ["claude"],
    extractor: rates.batch_billed_extractors[0],
    quarantined: [],
    extractions: [
      {
        engine: "claude",
        question_id: "q1",
        run_index: 0,
        brands: [],
        sources: [],
        refused: false,
        error: null,
        usage: { extract_input_tokens: M, extract_output_tokens: M },
      },
    ],
  };

  // One million in and one million out, at the checked-in extraction rates,
  // halved. Written as the sum rather than a constant so correcting a rate
  // corrects the expectation with it -- but the halving is asserted outright.
  const list = rates.engines._extract.input_per_m + rates.engines._extract.output_per_m;
  const priced = costOfRun(run, rates);
  assert.equal(priced.total, Number((list * rates.batch_discount).toFixed(4)));

  const local = costOfRun({ ...run, extractor: "claude-cli" }, rates);
  assert.equal(local.total, Number(list.toFixed(4)));
  assert.equal(local.total, priced.total * 2, "the discount did not apply");

  // The exact string that used to earn the discount must no longer earn it.
  assert.equal(batchBilled("api", rates), false);
  assert.equal(batchBilled(rates.batch_billed_extractors[0], rates), true);
  assert.equal(batchBilled(undefined, rates), false);
});

/**
 * The same rule, in Python, against the same hand-worked figure.
 *
 * Asserting it in one language would leave the other free to drift back, and
 * this is the branch that had already drifted once.
 */
test("Python prices a Batch-billed run at half too", () => {
  assert.ok(PYTHON, "no python interpreter found");
  const script = [
    "import json, sys",
    SRC_PATH_LINE,
    "from unprompted.cost import cost_of_run, batch_billed",
    "run = json.loads(sys.argv[1])",
    "local = dict(run, extractor='claude-cli')",
    "print(json.dumps([cost_of_run(run)[1], cost_of_run(local)[1],",
    "                  batch_billed('api'), batch_billed(run['extractor'])]))",
  ].join(NEWLINE);
  const run = {
    extractor: rates.batch_billed_extractors[0],
    extractions: [
      { engine: "claude", usage: { extract_input_tokens: 1_000_000, extract_output_tokens: 1_000_000 } },
    ],
  };
  const [batch, local, legacy, current] = JSON.parse(
    execFileSync(PYTHON, ["-c", script, JSON.stringify(run)], { encoding: "utf-8" }),
  );
  const list = rates.engines._extract.input_per_m + rates.engines._extract.output_per_m;
  assert.equal(batch, Number((list * rates.batch_discount).toFixed(4)));
  assert.equal(local, Number(list.toFixed(4)));
  assert.equal(legacy, false, '"api" must no longer earn the discount');
  assert.equal(current, true);
});

/**
 * An exact half, which the archive does not contain and the two languages used
 * to round in opposite directions.
 *
 * 25,000 ChatGPT input tokens at $1.25/M is $0.03125 exactly. Python's round()
 * took it to $0.0312 and JavaScript's Math.round to $0.0313, and every check
 * here passed because no real run has ever landed on a tie. A rule that agrees
 * except at the boundary is not a shared rule.
 */
test("Python and TypeScript round an exact half the same way", () => {
  assert.ok(PYTHON, "no python interpreter found");
  const run = {
    category: "synthetic",
    run_date: "2026-01-01",
    method_version: 1,
    runs_per_question: 1,
    engines: ["chatgpt"],
    quarantined: [],
    extractions: [
      {
        engine: "chatgpt",
        question_id: "q1",
        run_index: 0,
        brands: [],
        sources: [],
        refused: false,
        error: null,
        usage: { input_tokens: 25_000, output_tokens: 0 },
      },
    ],
  };

  const script = [
    "import json, sys",
    SRC_PATH_LINE,
    "from unprompted.cost import cost_of_run",
    "print(json.dumps(cost_of_run(json.loads(sys.argv[1]))[1]))",
  ].join(NEWLINE);
  const theirs = JSON.parse(
    execFileSync(PYTHON, ["-c", script, JSON.stringify(run)], { encoding: "utf-8" }),
  );
  const ours = costOfRun(run, rates).total;

  assert.equal(ours, theirs, "the two languages round a tie differently");
  // Half away from zero, stated outright so the shared rule is asserted rather
  // than merely shared.
  assert.equal(ours, 0.0313);
});

test("batch and cached usage have the same explicit price in Python and TypeScript", () => {
  const run = { extractor: "claude-api-extract", extractions: [
    { engine: "claude", usage: { batch_billed: 1, input_tokens: 1_000_000,
      output_tokens: 100_000, cache_read_input_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000, cache_creation_1h_input_tokens: 400_000,
      web_searches: 4, extract_cache_read_input_tokens: 500_000 } },
    { engine: "chatgpt", usage: { input_tokens: 1_000_000, cached_input_tokens: 400_000,
      output_tokens: 100_000, reasoning_tokens: 10_000, web_searches: 2 } },
  ] };
  const script = ["import json, sys", SRC_PATH_LINE,
    "from unprompted.cost import cost_of_run",
    "print(cost_of_run(json.loads(sys.argv[1]))[1])"].join(NEWLINE);
  const ours = costOfRun(run, rates);
  assert.equal(ours.total, 9.86);
  assert.equal(ours.items.find(i => i.label === "claude").inputTokens, 3_000_000);
  assert.equal(ours.items.find(i => i.label === "extract").inputTokens, 500_000);
  assert.equal(Number(execFileSync(PYTHON, ["-c", script, JSON.stringify(run)], { encoding: "utf-8" })), ours.total);
});

/**
 * The published week that says so.
 *
 * 2026-08-24 went out claiming "5 runs each across 3 engines" while Claude had
 * answered 51 of its 75. The chart now says which engine fell short and by how
 * much, and this asserts it against the archived file rather than against a
 * note somebody remembered to write -- and asserts that a complete week stays
 * silent, because a caveat that appears on every week is furniture.
 */
test("a short week is declared, and a full one is not", () => {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(RUNS, p), "utf-8"));

  const short = shortfall(read("2026-08-24/ai-image-generators.json"));
  assert.equal(short.length, 1, "one engine fell short that week");
  assert.equal(short[0].engine, "claude");
  assert.equal(short[0].answered, 51);
  assert.equal(short[0].attempted, 75);

  for (const week of ["2026-08-22/ai-coding-assistants.json", "2026-08-22/ai-writing-tools.json"]) {
    assert.deepEqual(shortfall(read(week)), [], `${week} answered everything`);
  }
});

/**
 * Engine health, on the case the dashboard aggregation used to hide.
 *
 * The check that holds a week runs per category. Merging two categories before
 * measuring lets a breach in one be averaged away by a clean one, which is the
 * precise failure the panel exists to prevent, so it is worth a fixture rather
 * than trust.
 */
test("engine health does not average a breach away", () => {
  const mk = (category, errors, total) => ({
    category,
    run_date: "2026-01-01",
    method_version: 1,
    runs_per_question: 1,
    engines: ["claude"],
    quarantined: [],
    extractions: Array.from({ length: total }, (_, i) => ({
      engine: "claude",
      question_id: `q${i}`,
      run_index: 0,
      brands: [],
      sources: [],
      refused: false,
      error: i < errors ? "boom" : null,
    })),
  });

  // 25% in one category, 0% in another of the same size: 12.5% merged, which
  // reads as healthy while the first category is over the line that holds a run.
  const bad = mk("a", 25, 100);
  const good = mk("b", 0, 100);

  const merged = engineHealth([bad, good]);
  assert.equal(merged.length, 1, "one engine across both");
  assert.ok(merged[0].over, "a breach in one category must not be averaged away");
  assert.equal(merged[0].worstCategory, "a");
  assert.equal(Number(merged[0].rate.toFixed(4)), 0.25, "the rate shown is the worst category's");

  // And a genuinely clean pair stays clean.
  const clean = engineHealth([mk("a", 0, 100), mk("b", 0, 100)]);
  assert.equal(clean[0].over, false);
  assert.equal(clean[0].rate, 0);
});

const runs = publishedRuns();

/** The one price list. A second copy here would defeat the point of the check. */
const rates = JSON.parse(
  fs.readFileSync(path.join(REPO, "data", "rates.json"), "utf-8"),
);

test("there is something to compare", () => {
  assert.ok(PYTHON, "no python interpreter found, so nothing was compared");
  assert.ok(runs.length > 0, "no published runs found in data/runs");
});

for (const { label, file } of runs) {
  test(`Python and TypeScript agree on ${label}`, () => {
    const record = JSON.parse(fs.readFileSync(file, "utf-8"));

    const ours = standings(record).map((b) => [
      b.brand,
      b.named,
      b.totalRuns,
      b.firstNamed,
      ratio(b.rotation),
      ratio(b.firstShare),
      b.steps.map(ratio),
    ]);

    const theirs = pythonRun(file);

    // Ordering is part of the metric: the board's rank comes from this sort.
    assert.deepEqual(
      ours,
      theirs.board,
      `standings differ between lib/metrics.ts and unprompted.aggregate for ${label}`,
    );

    // The money, through both implementations, from one file of rates. A
    // dashboard quoting a different figure than the terminal is the kind of
    // wrong that is otherwise only found by reconciling against an invoice.
    const priced = costOfRun(record, rates);
    assert.deepEqual(
      priced.items.map((i) => [
        i.label,
        i.calls,
        i.inputTokens,
        i.outputTokens,
        i.searches,
        Number(i.dollars.toFixed(6)),
      ]),
      theirs.cost,
      `cost differs between lib/metrics.ts and unprompted.cost for ${label}`,
    );
    assert.equal(priced.total, theirs.total, `total cost differs for ${label}`);
  });
}

/**
 * The limit that holds a week, in both languages.
 *
 * checks.py stops a run when one engine fails more than this share of its
 * calls; the dashboard draws the same line so an engine drifting toward it is
 * visible before the Monday it costs. Two different limits would mean a
 * dashboard saying "fine" about a run the checks are about to refuse.
 */
test("Python and TypeScript agree on the engine error limit", () => {
  assert.ok(PYTHON, "no python interpreter found");
  const script = [
    "import sys",
    SRC_PATH_LINE,
    "from unprompted.checks import MAX_ENGINE_ERROR_RATE",
    "print(MAX_ENGINE_ERROR_RATE)",
  ].join(NEWLINE);
  const theirs = Number(execFileSync(PYTHON, ["-c", script], { encoding: "utf-8" }).trim());
  assert.equal(MAX_ENGINE_ERROR_RATE, theirs, "the engine error limit has drifted");
});
