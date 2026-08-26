import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

import { ADMIN_COOKIE, deriveSessionToken, safeEqual } from "@/lib/auth";
import { recordRequest } from "@/lib/analytics";


/**
 * Gates the only non-public surface.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated the middleware
 * file convention in favour of this one.
 *
 * Single operator, so this is a shared secret rather than an account system.
 * Building user accounts for one person would be more machinery than the job
 * needs, and more attack surface than it deserves.
 *
 * If ADMIN_PASSWORD is unset the admin surface is closed entirely rather than
 * open — an unconfigured deploy must never be an unlocked one.
 *
 * It also counts agent traffic, because this is the only place an agent is
 * visible. GPTBot, ClaudeBot and PerplexityBot fetch the HTML and leave without
 * running a line of script, so a client-side beacon reports none of them and
 * neither does any hosted analytics product. Humans are counted by the beacon
 * instead, which runs after render and can report a referrer; recording them
 * here as well would double every number.
 *
 * The count never delays the response and never fails a request: it is handed
 * to waitUntil where the runtime provides it, and swallowed where it does not.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;

  // Analytics runs for every route in the matcher; the admin gate below only
  // applies to the admin ones. Ordered this way so a 401 is still counted.
  //
  // event.waitUntil is the documented way to keep background work alive past
  // the response. Reading a waitUntil off the request and calling it unbound
  // throws on `this`, which took the whole site to a 500 for every route until
  // the second parameter was used properly.
  event.waitUntil(
    recordRequest(path, request.headers.get("user-agent"), !isKnownPath(path)),
  );

  if (!path.startsWith("/admin") && !path.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_PASSWORD?.trim();

  if (!secret) {
    return new NextResponse("Admin is not configured on this deployment.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // The cookie carries an HMAC of a fixed label, never the password itself, so
  // a leaked cookie cannot be turned back into the credential.
  const expected = await deriveSessionToken(secret);
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  if (cookie && safeEqual(cookie, expected)) {
    return NextResponse.next();
  }

  // Basic auth: the browser supplies the prompt, we set the session once.
  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied && safeEqual(supplied, secret)) {
      const response = NextResponse.next();
      response.cookies.set(ADMIN_COOKIE, expected, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      return response;
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Unprompted admin", charset="UTF-8"',
      "Content-Type": "text/plain",
    },
  });
}

/**
 * The prefixes this site actually serves.
 *
 * Used to spot a request for something that was never here, which is worth
 * knowing mostly from agents: a person mistyping a URL says nothing, while an
 * assistant repeatedly asking for a path says what it expected to find. On this
 * site alone that is how /llms.txt got written.
 *
 * A prefix test rather than the real route table, so it catches the probes that
 * matter — /wp-admin, /.env, /openapi.json — and does not catch a bad slug
 * under a good prefix. Deliberate: the alternative is duplicating the router
 * here and getting it subtly wrong.
 *
 * Adding a top-level route means adding it here. The failure is visible rather
 * than silent: the new route starts appearing in "asked for, and not here".
 */
const KNOWN = [
  "/chart",
  "/brand/",
  "/compare",
  "/consensus",
  "/questions",
  "/categories",
  "/methodology",
  "/admin",
  "/api/",
  "/feed.xml",
  "/llms.txt",
  "/robots.txt",
  "/sitemap.xml",
];

function isKnownPath(path: string): boolean {
  return path === "/" || KNOWN.some((prefix) => path.startsWith(prefix));
}

/**
 * Everything a reader or an agent can actually land on.
 *
 * Deliberately not `/:path*`. Static assets, the beacon endpoint and the
 * Next.js internals would treble the request count while answering nothing: an
 * agent that pulled a favicon did not read the chart. The excluded prefixes are
 * matched here rather than filtered inside the handler so the middleware is
 * never invoked for them at all.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/track|favicon|icon|apple-icon|opengraph-image|sitemap.xml).*)",
  ],
};
