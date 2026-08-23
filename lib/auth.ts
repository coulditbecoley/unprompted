/**
 * Admin session tokens.
 *
 * The session cookie must never carry ADMIN_PASSWORD itself. A cookie is a
 * long-lived credential that travels through proxies, logs and browser storage,
 * and if one leaked the raw secret would be directly reusable. So the cookie
 * carries an HMAC of a fixed label under the secret: it proves the holder
 * authenticated, and it cannot be reversed into the password.
 *
 * Runs in both the edge middleware and the Node route handler, so it uses Web
 * Crypto rather than node:crypto.
 */

const LABEL = "unprompted-admin-session-v1";

export const ADMIN_COOKIE = "unprompted_admin";

export async function deriveSessionToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(LABEL));
  return toHex(new Uint8Array(signature));
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
 * Defence in depth. Middleware already gates this path; checking again here
 * means a future routing change can never silently expose the write path.
 */
export async function isAuthorised(request: Request): Promise<boolean> {
  const secret = process.env.ADMIN_PASSWORD?.trim();
  if (!secret) return false;
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\s*)${ADMIN_COOKIE}=([^;]+)`).exec(cookie);
  if (!match) return false;
  const expected = await deriveSessionToken(secret);
  return safeEqual(decodeURIComponent(match[1]), expected);
}
