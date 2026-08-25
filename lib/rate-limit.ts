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

const WINDOW = "1 m";
const LIMIT = 5;

let limiter: Ratelimit | null = null;

function get(): Ratelimit | null {
  if (limiter) return limiter;
  const r = redis();
  if (!r) return null;
  limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(LIMIT, WINDOW),
    prefix: "rl",
    // Counters are flushed in the background rather than awaited, so a limited
    // endpoint costs one round trip instead of two.
    analytics: false,
  });
  return limiter;
}

function callerFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** True when the request may proceed. */
export async function rateLimit(request: Request, bucket: string): Promise<boolean> {
  const rl = get();
  if (!rl) return true;
  try {
    const { success } = await rl.limit(`${bucket}:${callerFor(request)}`);
    return success;
  } catch {
    return true; // fail open, per the note above
  }
}
