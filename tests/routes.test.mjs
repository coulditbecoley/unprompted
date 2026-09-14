// Actual route handlers and Redis SDK; external transports are isolated in-process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { existsSync } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/server") specifier = "next/server.js";
  if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), root).href;
  else if (specifier.startsWith(".") && context.parentURL?.startsWith(root.href)
    && !context.parentURL.includes("/node_modules/")) specifier = new URL(specifier, context.parentURL).href;
  if (specifier.startsWith(root.href) && !specifier.includes("/node_modules/")
    && !/\.[cm]?[jt]sx?$/.test(specifier) && existsSync(fileURLToPath(specifier + ".ts"))) specifier += ".ts";
  return next(specifier, specifier.endsWith(".json") ? { ...context, importAttributes: { type: "json" } } : context);
}, load(url, context, next) {
  return next(url, url.endsWith(".json") ? { ...context, importAttributes: { type: "json" } } : context);
}});

process.env.ADMIN_PASSWORD = "offline-test";
process.env.GITHUB_TOKEN = "offline-test";
process.env.KV_REST_API_URL = "https://redis.invalid";
process.env.KV_REST_API_TOKEN = "offline-test";
process.env.ANALYTICS_NAMESPACE = "test-routes-offline";
const calls = [];
let remote = "old content";
let unavailable = false;
globalThis.fetch = async (url, init = {}) => {
  const address = String(url);
  if (address.startsWith("https://redis.invalid")) {
    if (unavailable) throw new Error("simulated outage");
    const body = JSON.parse(init.body);
    const commands = Array.isArray(body[0]) ? body : [body];
    calls.push(...commands);
    if (commands.some(c => String(c[0]).toLowerCase().startsWith("eval"))) throw new Error("limiter unavailable in this fixture");
    return Response.json(commands.map(c => ({ result: String(c[0]).toLowerCase() === "hgetall" ? [] : 1 })));
  }
  if (address.startsWith("https://api.github.com/repos/coulditbecoley/unprompted/contents/")) {
    calls.push([init.method ?? "GET", address]);
    if (init.method === "PUT") {
      const body = JSON.parse(init.body);
      assert.equal(body.sha, "remote-sha");
      remote = Buffer.from(body.content, "base64").toString();
      return Response.json({ commit: { html_url: "https://github.invalid/commit/test" } });
    }
    return Response.json({ sha: "remote-sha", content: Buffer.from(remote).toString("base64") });
  }
  throw new Error(`Unexpected external request: ${address}`);
};

const { POST: track } = await import("../app/api/track/route.ts");
const { POST: commit } = await import("../app/api/admin/commit/route.ts");
const { totals } = await import("../lib/analytics.ts");
const { deriveSessionToken } = await import("../lib/auth.ts");
const cookie = `unprompted_admin=${await deriveSessionToken("offline-test")}`;
const request = (path, body, headers = {}) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0", ...headers }, body: JSON.stringify(body),
});
const increments = () => calls.filter(c => String(c[0]).toLowerCase() === "hincrby").map(c => c[2]).sort();

test("held review reads recorded reasons and tolerates legacy or malformed reason fields", async (t) => {
  const { loadHeld, REPO_ROOT } = await import("../lib/data.ts");
  const dir = path.join(REPO_ROOT, "data", "held");
  const day = path.join(dir, "2026-09-14");
  const records = {
    "recorded.json": { publication_checks: { passed: false, reasons: ["Missing engine answers", "Unknown alias"] } },
    "legacy.json": {},
    "malformed.json": { publication_checks: { reasons: [null, 12, "", "  ", "Coverage failed"] } },
  };
  const originalExists = fs.existsSync;
  const originalReadDir = fs.readdirSync;
  const originalRead = fs.readFileSync;
  const originalStat = fs.statSync;
  t.mock.method(fs, "existsSync", (p) => p === dir || originalExists(p));
  t.mock.method(fs, "readdirSync", (p, ...args) => p === dir ? ["2026-09-14"] : p === day ? Object.keys(records) : originalReadDir(p, ...args));
  t.mock.method(fs, "statSync", (p, ...args) => p === day ? { isDirectory: () => true } : originalStat(p, ...args));
  t.mock.method(fs, "readFileSync", (p, ...args) => path.dirname(String(p)) === day
    ? JSON.stringify({ category: path.basename(String(p), ".json"), run_date: "2026-09-14", method_version: 1, runs_per_question: 1, engines: ["offline"], extractions: [], ...records[path.basename(String(p))] })
    : originalRead(p, ...args));
  const held = loadHeld().runs;
  assert.deepEqual(held.find(r => r.category === "recorded").reasons, ["Missing engine answers", "Unknown alias"]);
  assert.deepEqual(held.find(r => r.category === "legacy").reasons, []);
  assert.deepEqual(held.find(r => r.category === "malformed").reasons, ["Coverage failed"]);
  assert.equal(held.find(r => r.category === "legacy").errorRate, null);
});

test("held review follows explicit recovery chains and exposes corrupt files", async (t) => {
  const { loadHeld, REPO_ROOT } = await import("../lib/data.ts");
  const records = new Map();
  const add = (bucket, date, category, extra = {}) => records.set(path.join(REPO_ROOT, "data", bucket, date, `${category}.json`),
    JSON.stringify({ category, run_date: date, method_version: 1, runs_per_question: 1,
      engines: ["offline"], extractions: [], ...extra }));
  for (const category of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"]) add("held", "2026-09-01", category);
  add("held", "2026-09-02", "alpha", { source_run: "2026-09-01/alpha", measured_on: "2026-09-01" });
  add("runs", "2026-09-03", "alpha", { source_run: "2026-09-02/alpha", measured_on: "2026-09-01" });
  add("runs", "2026-09-04", "alpha", { source_run: "2026-09-03/alpha", measured_on: "2026-09-01" });
  add("runs", "2026-09-05", "beta"); // a newer measurement is not a recovery
  add("runs", "2026-09-03", "gamma", { source_run: "2026-09-01/alpha", measured_on: "2026-09-01" });
  add("runs", "2026-09-01", "delta"); // ambiguous parent identity in both buckets
  add("runs", "2026-09-03", "delta", { source_run: "2026-09-01/delta", measured_on: "2026-09-01" });
  add("runs", "2026-09-03", "epsilon", { source_run: "2026-09-01/epsilon" }); // different measured date
  add("runs", "2026-09-03", "zeta", { source_run: "2026-09-02/zeta", measured_on: "2026-09-01" }); // missing parent
  add("held", "2026-09-01", "eta", { source_run: "2026-09-03/eta" });
  add("runs", "2026-09-03", "eta", { source_run: "2026-09-01/eta", measured_on: "2026-09-01" }); // cycle
  add("held", "2026-09-01", "wrong", { category: "wrong-identity" });
  records.set(path.join(REPO_ROOT, "data/held/2026-09-01/broken.json"), "not JSON");
  const directories = new Map();
  for (const file of records.keys()) {
    for (const child of [file, path.dirname(file)]) {
      const parent = path.dirname(child);
      if (!directories.has(parent)) directories.set(parent, new Set());
      directories.get(parent).add(path.basename(child));
    }
  }
  const original = { exists: fs.existsSync, read: fs.readFileSync, list: fs.readdirSync, stat: fs.statSync };
  t.mock.method(fs, "existsSync", p => directories.has(p) || records.has(p) || original.exists(p));
  t.mock.method(fs, "readdirSync", (p, ...args) => directories.has(p) ? [...directories.get(p)] : original.list(p, ...args));
  t.mock.method(fs, "statSync", (p, ...args) => directories.has(p) ? { isDirectory: () => true } : original.stat(p, ...args));
  t.mock.method(fs, "readFileSync", (p, ...args) => records.has(p) ? records.get(p) : original.read(p, ...args));
  const held = loadHeld();
  assert.equal(held.runs.length, 8);
  assert.ok(held.runs.filter(r => r.category === "alpha").every(r => r.recoveredOn === "2026-09-04"));
  assert.ok(held.runs.filter(r => r.category !== "alpha").every(r => r.recoveredOn === undefined));
  assert.equal(held.errors.length, 2);
  assert.ok(held.errors.some(e => e.includes("data/held/2026-09-01/broken.json")));
  assert.ok(held.errors.some(e => e.includes("wrong.json: declares wrong-identity")));
});

test("archive scans expose directory failures and retain readable sibling records", async (t) => {
  const { loadAllRuns, REPO_ROOT } = await import("../lib/data.ts");
  const root = path.join(REPO_ROOT, "data", "runs");
  const originalList = fs.readdirSync, originalStat = fs.statSync, originalRead = fs.readFileSync;
  let rootFailure = null;
  const failure = () => { throw Object.assign(new Error("offline read failure"), { code: "EACCES" }); };
  t.mock.method(fs, "readdirSync", (p, ...args) => {
    if (p === root) {
      if (rootFailure) throw Object.assign(new Error("offline root failure"), { code: rootFailure });
      return ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"];
    }
    if (p === path.join(root, "2026-09-03")) return failure();
    if (p === path.join(root, "2026-09-04")) return ["alpha.json"];
    return originalList(p, ...args);
  });
  t.mock.method(fs, "statSync", (p, ...args) => {
    if (p === path.join(root, "2026-09-01")) return failure();
    if (path.dirname(p) === root) return { isDirectory: () => path.basename(p) !== "2026-09-02" };
    return originalStat(p, ...args);
  });
  t.mock.method(fs, "readFileSync", (p, ...args) => p === path.join(root, "2026-09-04/alpha.json")
    ? JSON.stringify({ category: "alpha", run_date: "2026-09-04", method_version: 1, runs_per_question: 1, engines: [], extractions: [] })
    : originalRead(p, ...args));
  const scan = loadAllRuns();
  assert.deepEqual(scan.runs.map(r => r.category), ["alpha"]);
  assert.equal(scan.errors.length, 3);
  assert.ok(scan.errors.some(e => e.includes("2026-09-02: expected an archive directory")));
  rootFailure = "EACCES";
  assert.deepEqual(loadAllRuns(), { runs: [], errors: [".: archive directory is unreadable"] });
  rootFailure = "ENOENT";
  assert.deepEqual(loadAllRuns(), { runs: [], errors: [] });
});

test("admin server component remains readable when a published category is corrupt", async (t) => {
  const ts = await import("typescript");
  const { runInNewContext } = await import("node:vm");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const data = await import("../lib/data.ts");
  const categories = await import("../lib/categories.ts");
  const providers = await import("../lib/providers.ts");
  const category = categories.DEFAULT_CATEGORY;
  const reading = data.loadHistory(category, true)[0];
  const broken = path.join(data.REPO_ROOT, "data", "runs", reading.run_date, `${category}.json`);
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (p, ...args) => p === broken ? "invalid JSON" : originalRead(p, ...args));
  assert.throws(() => data.loadHistory(category), /not valid JSON/);
  const source = originalRead(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {}, nativeRequire = createRequire(import.meta.url);
  runInNewContext(compiled, { exports, process, console, require: id => {
    if (id === "@/lib/data") return data;
    if (id === "@/lib/categories") return categories;
    if (id === "@/lib/providers") return providers;
    if (id === "@/lib/analytics") return { totals };
    // Exercise the page and its real archive readers; child widgets are outside this check.
    if (id.startsWith("@/components/") || id === "next/link") return new Proxy({}, { get: () => () => null });
    return nativeRequire(id);
  } });
  const html = renderToStaticMarkup(await exports.default({ searchParams: Promise.resolve({ category }) }));
  assert.match(html, /UNAVAILABLE/);
  assert.match(html, /not valid JSON/);
  assert.ok(html.includes(`data/runs/${reading.run_date}/${category}.json`));
  assert.match(html, /Published readings are unavailable/);
  assert.match(html, /PUBLISHED/); // healthy categories remain visible
});

test("brand history retains absent brands, dates rereads by measurement, and marks method breaks", async (t) => {
  const { brandHistory, REPO_ROOT } = await import("../lib/data.ts");
  const dir = path.join(REPO_ROOT, "data", "runs");
  const records = [
    ["2026-08-03", 1, true], ["2026-08-10", 1, false],
    ["2026-08-17", 2, true], ["2026-08-18", 2, true],
  ].map(([date, version, named]) => ({
    category: "history-test", run_date: date, method_version: version, runs_per_question: 1,
    ...(date === "2026-08-18" ? { measured_on: "2026-08-17", source_run: "2026-08-17" } : {}),
    engines: ["offline"], extractions: [{ engine: "offline", question_id: "q1", run_index: 0,
      brands: named ? [{ name: "Brand", position: 1 }] : [], sources: [], refused: false }],
  }));
  const files = new Map(records.map(r => [path.join(dir, r.run_date, "history-test.json"), JSON.stringify(r)]));
  const originalExists = fs.existsSync, originalReadDir = fs.readdirSync, originalRead = fs.readFileSync;
  t.mock.method(fs, "existsSync", p => p === dir || files.has(p) || originalExists(p));
  t.mock.method(fs, "readdirSync", (p, ...args) => p === dir ? records.map(r => r.run_date) : originalReadDir(p, ...args));
  t.mock.method(fs, "readFileSync", (p, ...args) => files.get(p) ?? originalRead(p, ...args));
  const history = brandHistory("history-test", "Brand");
  assert.deepEqual(history.map(h => h.date), ["2026-08-03", "2026-08-10", "2026-08-17"]);
  assert.deepEqual(history.map(h => h.rotation), [1, 0, 1]);
  assert.deepEqual(history.slice(0, 2).map(h => h.breakReason), [null, null]);
  assert.match(history[2].breakReason, /methodology version changed/);
  assert.equal(history[2].readingDate, "2026-08-18");
});

test("recorded absence of affiliations never falls back to today's ownership", async () => {
  const { loadAffiliations } = await import("../lib/data.ts");
  const category = "ai-coding-assistants";
  const live = loadAffiliations(category);
  assert.ok(Object.keys(live).length > 0);
  assert.deepEqual(loadAffiliations(category, { methodology: {} }), live);
  assert.deepEqual(loadAffiliations(category, { methodology: { aliases: {} } }), {});
  assert.deepEqual(loadAffiliations(category, { methodology: { aliases: { affiliations: {} } } }), {});
  assert.deepEqual(loadAffiliations("missing-category", { methodology: { aliases: {
    affiliations: { Archived: "old-engine", Shared: ["one", "two"] },
  } } }), { Archived: ["old-engine"], Shared: ["one", "two"] });
});

test("route integration: analytics and stale editor protection", async (t) => {
  await t.test("a brand click never becomes a brand view or referral", async () => {
    calls.length = 0;
    assert.equal((await track(request("/api/track", { path: "/brand/ai-coding-assistants/cursor", event: "out:source", referrer: "https://chatgpt.com" }))).status, 204);
    assert.deepEqual(increments(), ["c:out:source"]);
  });
  await t.test("a page view records each dimension once", async () => {
    calls.length = 0;
    await track(request("/api/track", { path: "/brand/ai-coding-assistants/cursor", referrer: "https://chatgpt.com/private?q=secret" }));
    assert.deepEqual(increments(), ["b:cursor (ai-coding-assistants)", "r:chatgpt.com", "t:human", "v:/brand/ai-coding-assistants/cursor"]);
    assert.ok(!JSON.stringify(calls).includes("private"));
    assert.ok(calls.filter(c => String(c[0]).toLowerCase() === "hincrby").every(c => c[1].startsWith("test-routes-offline:")));
  });
  await t.test("operator, cross-origin and malformed events do not count", async () => {
    calls.length = 0;
    await track(request("/api/track", { path: "/" }, { cookie }));
    await track(request("/api/track", { path: "/" }, { origin: "https://other.invalid" }));
    await track(request("/api/track", []));
    await track(request("/api/track", { path: "/", event: "bogus:event" }));
    assert.deepEqual(increments(), []);
  });
  await t.test("outage is unavailable, not zero", async () => {
    unavailable = true;
    assert.equal((await totals(1)).status, "unavailable");
    unavailable = false;
  });
  await t.test("stale editor cannot PUT over new remote content", async () => {
    calls.length = 0;
    const body = { target: "aliases", category: "ai-coding-assistants", baseline: "stale", content: "canonical:\n  Cursor: [cursor]\n" };
    assert.equal((await commit(request("/api/admin/commit", body, { cookie }))).status, 409);
    assert.ok(!calls.some(c => c[0] === "PUT"));
    body.baseline = remote;
    assert.equal((await commit(request("/api/admin/commit", body, { cookie }))).status, 200);
    assert.equal(remote, body.content);
  });
  await t.test("prototype targets and invalid question identities refuse before GitHub", async () => {
    calls.length = 0;
    for (const target of ["toString", "__proto__"]) {
      assert.equal((await commit(request("/api/admin/commit", { target, baseline: "", content: "{}" }, { cookie }))).status, 400);
    }
    const badQuestion = "category: wrong\nmethod_version: 1\nruns_per_question: 3\nquestions:\n  - id: q1\n    text: Question\n";
    assert.equal((await commit(request("/api/admin/commit", { target: "questions", category: "ai-coding-assistants", baseline: "", content: badQuestion }, { cookie }))).status, 400);
    const provider = { id: "chatgpt", label: "ChatGPT", kind: "api", role: "engine", enabled: true, env: "GITHUB_TOKEN" };
    assert.equal((await commit(request("/api/admin/commit", { target: "providers", baseline: "", content: JSON.stringify({ providers: [provider] }) }, { cookie }))).status, 400);
    assert.equal((await commit(request("/api/admin/commit", { target: "aliases", baseline: "", content: "canonical:\n  Alpha: [same]\n  Beta: [same]\n" }, { cookie }))).status, 400);
    assert.equal(calls.length, 0);
  });
});
