/**
 * Usage capture, and the reading of it.
 *
 * This is the project's first datastore, and it is deliberately not the
 * archive. `data/runs` is still the database in the sense that matters: the
 * measurement lives in git and is reproducible from it. This holds counters
 * about who read the site, which is operational, disposable, and expires on its
 * own after ninety days.
 *
 * Written to be cheap rather than complete. Upstash's free tier allows ten
 * thousand commands a day, so every event is one pipelined round trip of about
 * five commands, and all of a day's counters share a single hash rather than
 * spreading across one key per metric. That is roughly two thousand events a
 * day before the tier matters, which is far more than this site currently sees.
 * If it ever does, the fix is a paid tier, not a rewrite.
 *
 * Nothing here identifies a person. There is no cookie, no device id, no
 * fingerprint and no stored IP: a visitor is counted, never followed. Referrers
 * are reduced to a hostname, because the path a reader came from is their
 * business. What is stored about an agent is exactly what it announced.
 */

import { Redis } from "@upstash/redis";

import { identifyAgent, type Agent } from "./agents";

/**
 * Vercel's Upstash integration provisions KV_REST_API_URL and KV_REST_API_TOKEN
 * rather than the UPSTASH_REDIS_REST_* pair `Redis.fromEnv()` looks for, so the
 * client is built explicitly. Lazily, because top-level construction would
 * throw during `next build` on a deploy that has not been connected yet.
 */
let client: Redis | null = null;

export function redis(): Redis | null {
  if (client) return client;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

/** Whether capture is configured at all. Read by the dashboard to say so. */
export function analyticsEnabled(): boolean {
  return Boolean(redis());
}

const DAY_TTL = 60 * 60 * 24 * 90; // ninety days, then it prunes itself
const FEED_MAX = 200;

/**
 * Separator inside the agent/path composite field.
 *
 * A control character rather than a space, because two of the names this
 * joins contain one: "other automation" and "(no user agent)". Splitting
 * on the first space put half a name in the path column and the whole pair
 * in both, and the separator is invisible in a terminal so the stored data
 * looked correct while the dashboard did not.
 *
 * Exported so the reader splits on the same thing the writer joined with.
 * These were two literals in two files, which is how they came apart.
 */
export const PAIR_SEP = "\u0000";

const dayKey = (date: string) => `a:d:${date}`;
const FEED_KEY = "a:feed";
const SEEN_KEY = "a:seen";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The last `n` dates, most recent first. */
export function recentDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/* -- writing --------------------------------------------------------------- */

export type Hit = {
  path: string;
  /** Absent for an agent hit: agents do not run the beacon that sends this. */
  referrer?: string | null;
  agent?: Agent | null;
  /** A named interaction rather than a page view: "tab:compare", "cat:…". */
  event?: string | null;
  /** The query string, for the pages whose whole state lives in one. */
  query?: string | null;
  /** True when the request did not resolve to a page. */
  missing?: boolean;
};

/**
 * The brand a path is about, or null.
 *
 * Rolled up because `/brand/ai-coding-assistants/cursor` as a bare string
 * answers "was this page read" and not "is anyone looking up Cursor", which is
 * the question worth being able to answer for somebody.
 */
function brandOf(path: string): string | null {
  const m = /^\/brand\/([^/]+)\/([^/?#]+)/.exec(path);
  return m ? `${m[2]} (${m[1]})` : null;
}

/**
 * The two brands a comparison is between, normalised so that Cursor vs Copilot
 * and Copilot vs Cursor are one row. Which side a reader put first is not a
 * fact about the brands.
 */
function comparisonOf(path: string, query: string | null | undefined): string | null {
  if (!path.startsWith("/compare") || !query) return null;
  const params = new URLSearchParams(query);
  const a = params.get("a");
  const b = params.get("b");
  if (!a || !b || a === b) return null;
  const [left, right] = [a, b].sort();
  return `${left} vs ${right}`;
}

/**
 * One event. Never throws and never blocks the response: analytics failing must
 * cost a number in a dashboard, never a page load.
 */
export async function record(hit: Hit): Promise<void> {
  const r = redis();
  if (!r) return;

  const date = today();
  const key = dayKey(date);
  const fields: string[] = [];

  if (hit.agent) {
    fields.push(`g:${hit.agent.name}`);
    fields.push(`p:${hit.agent.purpose}`);
    fields.push(`gp:${hit.agent.name}${PAIR_SEP}${hit.path}`);
    fields.push("t:agent");
  } else if (hit.event) {
    fields.push(`c:${hit.event}`);
  } else {
    fields.push(`v:${hit.path}`);
    fields.push("t:human");
    if (hit.referrer) fields.push(`r:${hit.referrer}`);
  }

  // Dimensions that apply to a reader and an agent alike. A path that did not
  // resolve is worth more from an agent than from a person: it says what the
  // agent expected this site to have.
  if (hit.missing) fields.push(`x:${hit.path}`);
  const brand = brandOf(hit.path);
  if (brand) fields.push(`b:${brand}`);
  const comparison = comparisonOf(hit.path, hit.query);
  if (comparison) fields.push(`m:${comparison}`);

  try {
    const pipe = r.pipeline();
    for (const field of fields) pipe.hincrby(key, field, 1);
    pipe.expire(key, DAY_TTL);
    // A rolling window of individual events, so the dashboard can show what is
    // happening now rather than only what a day totalled. Capped, so it can
    // never grow without bound.
    pipe.lpush(
      FEED_KEY,
      JSON.stringify({
        at: Date.now(),
        path: hit.path,
        agent: hit.agent?.name ?? null,
        vendor: hit.agent?.vendor ?? null,
        purpose: hit.agent?.purpose ?? null,
        event: hit.event ?? null,
        referrer: hit.referrer ?? null,
      }),
    );
    pipe.ltrim(FEED_KEY, 0, FEED_MAX - 1);

    // First and last seen, outside the daily keys because the question is "am I
    // in this crawler's refresh cycle", which a per-day count cannot answer.
    // Never expires: two fields per agent is a rounding error against a rolling
    // ninety days of paths.
    if (hit.agent) {
      pipe.hsetnx(SEEN_KEY, `${hit.agent.name}:first`, Date.now());
      pipe.hset(SEEN_KEY, { [`${hit.agent.name}:last`]: Date.now() });
    }

    await pipe.exec();
  } catch {
    // Deliberately silent. A dropped count is not worth a log line on every
    // request, and there is nothing the caller could do about it.
  }
}

/** Classify and record a raw request. Used by the proxy for every page. */
export async function recordRequest(
  path: string,
  userAgent: string | null,
  missing = false,
): Promise<void> {
  const agent = identifyAgent(userAgent);
  // Humans are recorded by the beacon instead, which runs after the page loads
  // and can therefore also report the referrer. Recording them here as well
  // would double every count.
  //
  // A miss is the exception: the beacon never runs on a page that did not
  // load, so a person asking for something that is not here would otherwise go
  // uncounted entirely.
  if (!agent) {
    if (missing) await record({ path, missing: true });
    return;
  }
  await record({ path, agent, missing });
}

/**
 * Hosts that are an assistant rather than a website.
 *
 * A visit referred by one of these is the mirror image of an agent hit: an
 * assistant answered somebody, that person clicked through, and the chart was
 * cited to a human rather than only crawled. It is the most valuable referrer
 * this site can receive and it was sitting in a list next to google.com.
 */
const ASSISTANT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "bing.com",
  "you.com",
  "phind.com",
  "poe.com",
  "duckduckgo.com",
  "mistral.ai",
  "chat.mistral.ai",
  "grok.com",
  "x.ai",
];

export function isAssistantHost(host: string): boolean {
  return ASSISTANT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** When each agent was first and last seen, for cadence rather than volume. */
export type Cadence = { agent: string; first: number; last: number };

export async function cadence(): Promise<Cadence[]> {
  const r = redis();
  if (!r) return [];
  try {
    const hash = await r.hgetall<Record<string, string>>(SEEN_KEY);
    if (!hash) return [];
    const byAgent = new Map<string, { first: number; last: number }>();
    for (const [field, value] of Object.entries(hash)) {
      const cut = field.lastIndexOf(":");
      if (cut < 1) continue;
      const name = field.slice(0, cut);
      const which = field.slice(cut + 1);
      const row = byAgent.get(name) ?? { first: 0, last: 0 };
      if (which === "first") row.first = Number(value) || 0;
      if (which === "last") row.last = Number(value) || 0;
      byAgent.set(name, row);
    }
    return [...byAgent.entries()]
      .map(([agent, v]) => ({ agent, ...v }))
      .sort((a, b) => b.last - a.last);
  } catch {
    return [];
  }
}

/* -- reading --------------------------------------------------------------- */

export type Totals = {
  views: Array<[string, number]>;
  brands: Array<[string, number]>;
  comparisons: Array<[string, number]>;
  missing: Array<[string, number]>;
  /** Referrers that are themselves an assistant, split out from the rest. */
  fromAssistants: Array<[string, number]>;
  agents: Array<[string, number]>;
  agentPaths: Array<[string, number]>;
  clicks: Array<[string, number]>;
  referrers: Array<[string, number]>;
  purposes: Record<string, number>;
  humanHits: number;
  agentHits: number;
};

const EMPTY: Totals = {
  views: [],
  brands: [],
  comparisons: [],
  missing: [],
  fromAssistants: [],
  agents: [],
  agentPaths: [],
  clicks: [],
  referrers: [],
  purposes: {},
  humanHits: 0,
  agentHits: 0,
};

/** Everything counted over the last `days` days, merged and sorted. */
export async function totals(days = 30): Promise<Totals> {
  const r = redis();
  if (!r) return EMPTY;

  let hashes: Array<Record<string, string> | null>;
  try {
    hashes = await Promise.all(
      recentDays(days).map((d) => r.hgetall<Record<string, string>>(dayKey(d))),
    );
  } catch {
    return EMPTY;
  }

  const bucket: Record<string, Map<string, number>> = {
    v: new Map(),
    b: new Map(),
    m: new Map(),
    x: new Map(),
    g: new Map(),
    gp: new Map(),
    c: new Map(),
    r: new Map(),
    p: new Map(),
    t: new Map(),
  };

  for (const hash of hashes) {
    if (!hash) continue;
    for (const [field, raw] of Object.entries(hash)) {
      const colon = field.indexOf(":");
      if (colon < 1) continue;
      const kind = field.slice(0, colon);
      const name = field.slice(colon + 1);
      const map = bucket[kind];
      if (!map) continue;
      map.set(name, (map.get(name) ?? 0) + Number(raw ?? 0));
    }
  }

  const ranked = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);

  const referrers = ranked(bucket.r);
  return {
    views: ranked(bucket.v),
    brands: ranked(bucket.b),
    comparisons: ranked(bucket.m),
    missing: ranked(bucket.x),
    // Derived at read time rather than stored twice: a referrer either is an
    // assistant or is not, and that is a property of the hostname.
    fromAssistants: referrers.filter(([host]) => isAssistantHost(host)),
    agents: ranked(bucket.g),
    agentPaths: ranked(bucket.gp),
    clicks: ranked(bucket.c),
    referrers,
    purposes: Object.fromEntries(bucket.p),
    humanHits: bucket.t.get("human") ?? 0,
    agentHits: bucket.t.get("agent") ?? 0,
  };
}

export type FeedEntry = {
  at: number;
  path: string;
  agent: string | null;
  vendor: string | null;
  purpose: string | null;
  event: string | null;
  referrer: string | null;
};

/** The rolling window of individual events, newest first. */
export async function feed(limit = 60): Promise<FeedEntry[]> {
  const r = redis();
  if (!r) return [];
  try {
    const rows = await r.lrange<FeedEntry | string>(FEED_KEY, 0, limit - 1);
    return rows
      .map((row) => {
        // The SDK deserialises JSON automatically, but a value written by an
        // older build may still arrive as a string.
        if (typeof row !== "string") return row;
        try {
          return JSON.parse(row) as FeedEntry;
        } catch {
          return null;
        }
      })
      .filter((row): row is FeedEntry => Boolean(row));
  } catch {
    return [];
  }
}

/** Per-day totals for a sparkline, oldest first. */
export async function daily(days = 14): Promise<Array<{ date: string; human: number; agent: number }>> {
  const r = redis();
  if (!r) return [];
  const dates = recentDays(days).reverse();
  try {
    const hashes = await Promise.all(
      dates.map((d) => r.hmget<Record<string, string>>(dayKey(d), "t:human", "t:agent")),
    );
    return dates.map((date, i) => ({
      date,
      human: Number(hashes[i]?.["t:human"] ?? 0),
      agent: Number(hashes[i]?.["t:agent"] ?? 0),
    }));
  } catch {
    return [];
  }
}
