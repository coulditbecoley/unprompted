import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_COOKIE, deriveSessionToken, safeEqual } from "@/lib/auth";

/**
 * Gates the only non-public surface.
 *
 * Single operator, so this is a shared secret rather than an account system.
 * Building user accounts for one person would be more machinery than the job
 * needs, and more attack surface than it deserves.
 *
 * If ADMIN_PASSWORD is unset the admin surface is closed entirely rather than
 * open — an unconfigured deploy must never be an unlocked one.
 */
export async function middleware(request: NextRequest) {
  const secret = process.env.ADMIN_PASSWORD;

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

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
