import { Ratelimit } from "@upstash/ratelimit";

import { redis } from "./analytics";

/**
 * A ceiling on how often one caller can use a public write endpoint.
 *
 * The audit's M-3: `/api/subscribe` forwarded everything it was handed, so it
 * could be used to burn a provider's quota or to bury a stranger's inbox in
 * confirmation mail. There was no cheap way to fix it while the project had no
 * datastore. There is one now.
 *
 * Fails **open**. A rate limiter that rejects traffic when its own backend is
 * unreachable turns a Redis outage into a site outage, and the thing being
 * protected here is a newsletter signup rather than anything dangerous. The
 * trade is deliberate and the direction is the important half.
 *
 * The caller is identified by IP, taken from the proxy headers Vercel sets. It
 * is used to build a key and is never stored: `@upstash/ratelimit` keeps a
 * counter under a hash of it that expires within the window, and nothing else
 * in this codebase writes an address anywhere.
 */

/**
 * Per bucket, because the two endpoints are nothing alike.
 *
 * A signup is a deliberate act a person does once, so five a minute is already
 * four more than anybody needs. The analytics beacon fires on every page view
 * and every tracked click, so the same ceiling would throw away real readers;
 * thirty a minute is an order of magnitude above the heaviest real session and
 * still stops a loop.
 *
 * Worth being honest about what this is not: a per-IP ceiling stops a careless
 * script and an accidental loop, and does nothing against traffic spread over
 * many addresses. The real backstop against a metered quota is that everything
 * downstream fails silently -- a rejected write costs a number in a dashboard,
 * never a page.
 */
const LIMITS: Record<string, number> = { subscribe: 5, track: 30 };
const WINDOW = "1 m";

const limiters = new Map<string, Ratelimit>();

function get(bucket: string): Ratelimit | null {
  const existing = limiters.get(bucket);
  if (existing) return existing;
  const r = redis();
  if (!r) return null;
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(LIMITS[bucket] ?? 5, WINDOW),
    prefix: `rl:${bucket}`,
    // Counters are flushed in the background rather than awaited, so a limited
    // endpoint costs one round trip instead of two.
    analytics: false,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

function callerFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * How long the limiter may take before the request goes through anyway.
 *
 * Failing open is not enough on its own: a backend that refuses a connection
 * fails fast, and one that is merely unreachable can hang the TLS handshake
 * until the caller gives up. Awaiting that on a public endpoint makes a slow
 * Redis into a slow website, which is a worse outcome than an uncounted event.
 * Observed as a request that never returned at all, rather than reasoned about.
 */
const BUDGET_MS = 800;

/** True when the request may proceed. */
export async function rateLimit(request: Request, bucket: string): Promise<boolean> {
  const rl = get(bucket);
  if (!rl) return true;
  try {
    return await Promise.race([
      rl.limit(callerFor(request)).then(({ success }) => success),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), BUDGET_MS)),
    ]);
  } catch {
    return true; // fail open, per the note above
  }
}
