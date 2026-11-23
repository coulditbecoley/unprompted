import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email capture, forwarded straight to SelfSend.
 *
 * The subscriber list is deliberately never stored here. Holding email
 * addresses would mean a database, a consent record, an unsubscribe flow and a
 * GDPR surface. SelfSend, the operator's own mailing platform, already has all
 * of that, so this route is a thin forwarder and SelfSend owns the list.
 *
 * SELFSEND_SIGNUP_URL is the form address of a SelfSend sign-up link
 * (https://<selfsend>/api/signup/<token>). The link decides which group the
 * address joins, so moving signups to another group is a change in SelfSend,
 * not here. That endpoint is built for plain HTML forms: it takes a
 * form-encoded email and always answers with a redirect, to its thank-you page
 * when it accepted the address and to the same page with ?state=... when it
 * did not. It is called from here, not from the browser, because the CSP is
 * form-action 'self' and the endpoint sends no CORS headers.
 *
 * Whenever SelfSend is not set up or does not accept the address, the route
 * returns 503 with `inbox: true`. That status is load-bearing: the form then
 * delivers the address to the operator's inbox instead, so a signup is never
 * lost to an outage. The fallback runs in the browser because Web3Forms
 * rejects server-side calls on the free plan.
 */

const MAX_EMAIL = 254;

const fallback = (error: string) =>
  NextResponse.json({ error, inbox: true }, { status: 503 });

export async function POST(request: Request) {
  // Closes M-3 from the 2026-08-25 audit: this forwarded every request it was
  // given, so it could be used to exhaust a provider's quota or to spam a
  // stranger's inbox with confirmations. Cheap now that there is a Redis.
  if (!(await rateLimit(request, "subscribe"))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 },
    );
  }

  const endpoint = process.env.SELFSEND_SIGNUP_URL;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const email = String((payload as { email?: string })?.email ?? "").trim();

  // Deliberately permissive: SelfSend validates again, and rejecting
  // unusual-but-valid addresses is a worse failure than passing one through.
  if (!email || email.length > MAX_EMAIL || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

  if (!endpoint) return fallback("not_configured");

  try {
    // ponytail: SelfSend throttles this endpoint per caller address, and every
    // call from here shares this server's. Fine at this volume, and a throttled
    // signup still reaches the inbox; send the visitor's address along if
    // signups ever arrive faster than five a minute.
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(10000),
      method: "POST",
      redirect: "manual",
      body: new URLSearchParams({ email }),
    });
    const location = res.headers.get("location") ?? "";

    // Already subscribed and unsubscribed addresses get the same plain
    // thank-you redirect, so this never leaks who is on the list.
    if (res.status === 303 && !location.includes("state=")) {
      return NextResponse.json({ ok: true });
    }
    return fallback("unavailable");
  } catch {
    return fallback("unavailable");
  }
}
