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

import { exceedsNoise, marginOfError, standings } from "../lib/metrics.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const RUNS = path.join(REPO, "data", "runs");

/**
 * The interpreter, whatever it is called here.
 *
 * Windows installs `python`, the CI runner installs `python3`, and picking
 * either one would have made this pass on a laptop and fail on a build. The
 * modules it imports -- aggregate and models -- are pure standard library, so
 * nothing needs installing first.
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
const ratio = (n) => Number(n.toFixed(RATIO_DP));
function pythonStandings(file) {
  const script = [
    "import json, sys",
    SRC_PATH_LINE,
    "from unprompted.aggregate import brand_week",
    "run = json.load(open(sys.argv[1], encoding='utf-8'))",
    "print(json.dumps([[b.brand, b.named, b.total_runs, b.first_named,",
    `                   round(b.rotation, ${RATIO_DP}), round(b.first_share, ${RATIO_DP}),`,
    `                   [round(s, ${RATIO_DP}) for s in b.steps]] for b in brand_week(run)]))`,
  ].join("\n");
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

const runs = publishedRuns();

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

    const theirs = pythonStandings(file);

    // Ordering is part of the metric: the board's rank comes from this sort.
    assert.deepEqual(
      ours,
      theirs,
      `standings differ between lib/metrics.ts and unprompted.aggregate for ${label}`,
    );
  });
}
