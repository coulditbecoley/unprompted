import { NextResponse } from "next/server";

import { identifyAgent } from "@/lib/agents";
import { record } from "@/lib/analytics";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The human half of capture.
 *
 * Agents are counted in `proxy.ts`, because they never reach this route: they
 * do not run the script that calls it. This is the other side of that split —
 * a page view or a click reported by a browser that actually rendered the page.
 *
 * Deliberately anonymous. No cookie is set or read, no identifier is minted,
 * and the address the request came from is never stored. A referrer is reduced
 * to its hostname before it is written, because which page of a site somebody
 * arrived from is their business and the hostname is the only part that answers
 * "where do readers come from".
 *
 * Always answers 204, including when it did nothing. A tracking endpoint that
 * reports failures to the page gives an attacker a probe and gives an honest
 * visitor a console error over a number nobody will miss.
 */

const MAX_PATH = 300;
const MAX_EVENT = 80;
const MAX_QUERY = 300;

/**
 * What a path from this site can actually look like.
 *
 * Anything recorded here becomes a Redis field name and then a cell in a
 * Markdown table in the operator's private vault, which is a second rendering
 * boundary that React's escaping does not cover. A pipe or a newline in a page
 * path would rewrite that table; a link or image would render in it. The
 * charset is the one real URLs on this site use, so nothing legitimate is lost
 * by refusing the rest.
 */
const SAFE_PATH = /^\/[A-Za-z0-9\-._~/%]*$/;

/**
 * Label prefixes the beacon actually emits. Anything else is not ours.
 *
 * `signup:` and `contact:` carry no address and never could: the beacon sends a
 * fixed label, and the address itself goes to the mail provider from the form.
 * What is counted is that somebody finished, which is the whole question the
 * email capture exists to answer and the one thing this site could not see.
 */
const EVENT_PREFIXES = ["tab:", "sort:", "share:", "nav:", "out:", "signup:", "contact:"];

/**
 * Only the keys the comparison pages address themselves with.
 *
 * A query string is a good way to accidentally store whatever somebody typed,
 * so the beacon sends one only for those routes and this keeps only the
 * parameters that are part of the page's identity. Anything else is dropped
 * rather than trusted.
 */
const QUERY_KEYS = new Set(["a", "b", "c"]);

function safeQuery(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const out = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(raw.slice(0, MAX_QUERY))) {
    // Same reasoning as SAFE_PATH: these become labels in a Markdown table.
    if (QUERY_KEYS.has(key) && value && /^[\w .+-]{1,80}$/.test(value)) {
      out.set(key, value);
    }
  }
  const s = out.toString();
  return s || null;
}

/** Hostname only, and only when it is not us. */
function referrerHost(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    return host && host !== "unprompted.report" ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // The only unauthenticated write on the site, and it costs Redis commands on
  // a metered quota, so a script pointed at it burns the budget the real
  // numbers depend on and inflates them on the way. The ceiling is set well
  // above what a person browsing quickly produces: a fast reader generates
  // maybe twenty events a minute, and the limiter costs one command against the
  // five to eleven each recorded event already spends.
  if (!(await rateLimit(request, "track"))) {
    return new NextResponse(null, { status: 204 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const body = payload as {
    path?: unknown;
    referrer?: unknown;
    event?: unknown;
    query?: unknown;
  };
  const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH) : "";
  if (!SAFE_PATH.test(path)) return new NextResponse(null, { status: 204 });

  // The operator is not the audience. The beacon already skips /admin, but a
  // guard that lives only in the browser is one a stale bundle or a hand-made
  // request walks straight past, and this is the number it would corrupt.
  if (path.startsWith("/admin")) return new NextResponse(null, { status: 204 });

  // Something announcing itself as an agent while calling the browser beacon is
  // either a headless browser or a forgery. Either way it is not the human
  // signal this route exists to collect, and the proxy already counted it.
  if (identifyAgent(request.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 });
  }

  const rawEvent =
    typeof body.event === "string" && body.event
      ? body.event.slice(0, MAX_EVENT).replace(/[^\w:./ -]/g, "")
      : null;
  // An allowlist rather than a filter. The beacon emits these prefixes and no
  // others; a label that is none of them did not come from this site's own
  // controls, and a counter nobody can explain is worse than one that is
  // missing.
  const event =
    rawEvent && EVENT_PREFIXES.some((p) => rawEvent.startsWith(p)) ? rawEvent : null;
  if (rawEvent && !event) return new NextResponse(null, { status: 204 });

  await record({
    path,
    query: event ? null : safeQuery(body.query),
    referrer: event ? null : referrerHost(body.referrer),
    event,
  });
  return new NextResponse(null, { status: 204 });
}
