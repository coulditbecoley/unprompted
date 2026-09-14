// Actual route handlers and Redis SDK; external transports are isolated in-process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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
  t.mock.method(fs, "existsSync", (p) => p === dir || originalExists(p));
  t.mock.method(fs, "readdirSync", (p, ...args) => p === dir ? ["2026-09-14"] : p === day ? Object.keys(records) : originalReadDir(p, ...args));
  t.mock.method(fs, "readFileSync", (p, ...args) => path.dirname(String(p)) === day
    ? JSON.stringify({ category: path.basename(String(p), ".json"), run_date: "2026-09-14", extractions: [], ...records[path.basename(String(p))] })
    : originalRead(p, ...args));
  const held = loadHeld();
  assert.deepEqual(held.find(r => r.category === "recorded").reasons, ["Missing engine answers", "Unknown alias"]);
  assert.deepEqual(held.find(r => r.category === "legacy").reasons, []);
  assert.deepEqual(held.find(r => r.category === "malformed").reasons, ["Coverage failed"]);
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
