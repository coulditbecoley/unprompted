/**
 * The TypeScript half of the cross-implementation agreement check.
 *
 * Rotation is computed twice: in Python for the sanity checks, and in
 * lib/data.ts for the site. Two implementations of one metric drift silently,
 * and a chart that disagrees with its own checks is the failure this project
 * can least afford. Both sides assert against tests/fixtures, so drift in
 * either fails a build.
 *
 * Run with: node --test tests/agreement.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");

const run = JSON.parse(fs.readFileSync(path.join(FIXTURES, "run-sample.json"), "utf-8"));
const expected = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "expected-standings.json"), "utf-8"),
);

/**
 * Mirrors lib/data.ts `standings()`. Kept here as plain JS so the check runs
 * without a TypeScript build step; if these diverge, the fixture catches it.
 */
function standings(record) {
  const answers = record.extractions.filter((e) => !e.error && !e.refused);
  const total = answers.length;
  if (total === 0) return [];

  const names = new Set();
  for (const ex of answers) for (const b of ex.brands) names.add(b.name);

  const out = [];
  for (const name of names) {
    const cells = [];
    let firstNamed = 0;
    for (const ex of answers) {
      const hit = ex.brands.find((b) => b.name === name);
      cells.push(Boolean(hit));
      if (hit && hit.position === 1) firstNamed += 1;
    }
    const named = cells.filter(Boolean).length;
    out.push({
      brand: name,
      named,
      totalRuns: total,
      rotation: named / total,
      firstNamed,
      firstShare: firstNamed / total,
      cells,
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

function sourceCounts(record) {
  const counts = new Map();
  for (const ex of record.extractions.filter((e) => !e.error && !e.refused)) {
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

test("TypeScript side matches the shared expectation", () => {
  const got = standings(run);

  assert.deepEqual(
    got.map((g) => g.brand),
    expected.standings.map((e) => e.brand),
    "ordering must match Python",
  );

  got.forEach((actual, i) => {
    const want = expected.standings[i];
    assert.equal(actual.named, want.named, `${want.brand} named`);
    assert.equal(actual.totalRuns, want.totalRuns, `${want.brand} totalRuns`);
    assert.ok(
      Math.abs(actual.rotation - want.rotation) < 1e-4,
      `${want.brand} rotation ${actual.rotation} != ${want.rotation}`,
    );
    assert.equal(actual.firstNamed, want.firstNamed, `${want.brand} firstNamed`);
    assert.ok(
      Math.abs(actual.firstShare - want.firstShare) < 1e-4,
      `${want.brand} firstShare ${actual.firstShare} != ${want.firstShare}`,
    );
    assert.deepEqual(actual.cells, want.cells, `${want.brand} cells`);
  });

  assert.equal(got[0].totalRuns, expected.totalRuns);
  assert.deepEqual(sourceCounts(run)[0], expected.topSource);
});
