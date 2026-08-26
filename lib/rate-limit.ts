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
 * The caller is identified by IP, taken from the proxy headers Vercel sets,
 * and the address itself never reaches Redis: it is hashed with a server-side
 * secret first, so the key is a pseudonym that cannot be reversed into an
 * address by anyone reading the store.
 *
 * That was not true when this was written. The claim in the README said no
 * address is stored while `rl:track:<raw ip>` sat in Redis for the length of a
 * window. Short-lived is not the same as absent, and a project whose whole
 * pitch is that its claims can be checked does not get to round that off.
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

async function callerFor(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    (forwarded ? forwarded.split(",")[0]!.trim() : null) ??
    request.headers.get("x-real-ip") ??
    "unknown";

  // Keyed by a secret so the hash cannot be reversed by trying every address:
  // there are only four billion of them and a bare digest is a lookup table.
  // ADMIN_PASSWORD is reused as the key rather than adding a variable an
  // operator has to know to set; it is already required for the site to run at
  // all, and it never leaves the server.
  const secret = process.env.ADMIN_PASSWORD ?? "unprompted";
  const bytes = new TextEncoder().encode(`${secret}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      callerFor(request)
        .then((caller) => rl.limit(caller))
        .then(({ success }) => success),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), BUDGET_MS)),
    ]);
  } catch {
    return true; // fail open, per the note above
  }
}
