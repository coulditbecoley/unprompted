import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email capture, forwarded straight to a provider.
 *
 * The subscriber list is deliberately never stored here. Holding email
 * addresses would mean a database, a consent record, an unsubscribe flow and a
 * GDPR surface — real machinery, and all of it already solved by any newsletter
 * provider. So this route is a thin forwarder and the provider owns the list.
 *
 * Buttondown is the default because it can also send this publication's own
 * feed on a schedule, which means the weekly digest needs no sending code here
 * at all. Swapping providers is a change to one fetch.
 *
 * With no key configured the route returns 503 and says so. That status is
 * load-bearing: while there is no provider, the form falls back to delivering
 * the address to the operator's inbox, and it needs to be able to tell "no
 * provider yet" apart from "the provider refused". The fallback runs in the
 * browser rather than here, because Web3Forms rejects server-side calls on the
 * free plan outright -- "use our API in client side" -- so a server-side
 * forward would have failed every time while looking perfectly reasonable.
 *
 * Setting BUTTONDOWN_API_KEY switches this to the real provider, and the
 * fallback stops firing on its own. Nothing else changes.
 */

const ENDPOINT = "https://api.buttondown.com/v1/subscribers";
const MAX_EMAIL = 254;

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

  const token = process.env.BUTTONDOWN_API_KEY;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const email = String((payload as { email?: string })?.email ?? "").trim();

  // Deliberately permissive: the provider does real verification, and rejecting
  // unusual-but-valid addresses is a worse failure than passing one through.
  if (!email || email.length > MAX_EMAIL || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json(
      { error: "not_configured", inbox: true },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email_address: email, tags: ["unprompted.report"] }),
    });

    // Already subscribed is a success from the visitor's point of view. Telling
    // them it failed would be both confusing and a small privacy leak about who
    // is on the list.
    if (res.ok || res.status === 409) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "The provider rejected that. Try again in a moment." },
      { status: 502 },
    );
  } catch {
    return NextResponse.json({ error: "Could not reach the email provider." }, { status: 502 });
  }
}

