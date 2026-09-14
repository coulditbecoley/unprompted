/**
 * Admin session tokens.
 *
 * The session cookie must never carry ADMIN_PASSWORD itself. A cookie is a
 * long-lived credential that travels through proxies, logs and browser storage,
 * and if one leaked the raw secret would be directly reusable. So the cookie
 * carries an HMAC of a fixed label under the secret: it proves the holder
 * authenticated, and it cannot be reversed into the password.
 *
 * Runs in both the proxy and the Node route handler, so it uses Web Crypto
 * rather than node:crypto.
 */

const LABEL = "unprompted-admin-session-v1";

export const ADMIN_COOKIE = "unprompted_admin";

export async function deriveSessionToken(secret: string, expires = Math.floor(Date.now() / 1000) + 8 * 3600): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(`${LABEL}:${expires}`));
  return `${expires}.${toHex(new Uint8Array(signature))}`;
}

export async function validSession(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!/^\d{10}\.[a-f0-9]{64}$/.test(token)) return false;
  const expires = Number(token.split(".")[0]);
  return expires > now && expires <= now + 8 * 3600 && safeEqual(token, await deriveSessionToken(secret, expires));
}

// ponytail: process-local login throttle; deployment-wide limits need shared edge protection.
const attempts = new Map<string, { until: number; count: number }>();
export async function allowLogin(request: Request): Promise<boolean> {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key);
  const address = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const key = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${process.env.ADMIN_PASSWORD}:${address}`))));
  const item = attempts.get(key) ?? { until: now + 60_000, count: 0 };
  if (!attempts.has(key) && attempts.size >= 1000) return false;
  item.count++;
  attempts.set(key, item);
  return item.count <= 10;
}

/** Length-independent comparison, so a wrong guess leaks no timing signal. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Defence in depth. The proxy already gates this path; checking again here
 * means a future routing change can never silently expose the write path.
 */
export async function isAuthorised(request: Request): Promise<boolean> {
  const secret = process.env.ADMIN_PASSWORD?.trim();
  if (!secret) return false;
  // Split rather than a regex. The previous pattern was built from a template
  // literal, where `\s` is not a valid escape and collapses to a bare `s`: the
  // compiled pattern was `(?:^|;s*)`, so it matched only when the admin cookie
  // happened to be first in the header and rejected every other valid request.
  const prefix = `${ADMIN_COOKIE}=`;
  const value = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) return false;
  try { return await validSession(decodeURIComponent(value), secret); }
  catch { return false; }
}
