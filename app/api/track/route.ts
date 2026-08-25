import { NextResponse } from "next/server";

import { identifyAgent } from "@/lib/agents";
import { record } from "@/lib/analytics";

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
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const body = payload as { path?: unknown; referrer?: unknown; event?: unknown };
  const path = typeof body.path === "string" ? body.path.slice(0, MAX_PATH) : "";
  if (!path.startsWith("/")) return new NextResponse(null, { status: 204 });

  // Something announcing itself as an agent while calling the browser beacon is
  // either a headless browser or a forgery. Either way it is not the human
  // signal this route exists to collect, and the proxy already counted it.
  if (identifyAgent(request.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 });
  }

  const event =
    typeof body.event === "string" && body.event
      ? body.event.slice(0, MAX_EVENT).replace(/[^\w:./ -]/g, "")
      : null;

  await record({ path, referrer: event ? null : referrerHost(body.referrer), event });
  return new NextResponse(null, { status: 204 });
}
