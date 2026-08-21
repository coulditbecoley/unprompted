import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
export function middleware(request: NextRequest) {
  const secret = process.env.ADMIN_PASSWORD;

  if (!secret) {
    return new NextResponse("Admin is not configured on this deployment.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const cookie = request.cookies.get("unprompted_admin")?.value;
  if (cookie && safeEqual(cookie, secret)) {
    return NextResponse.next();
  }

  // Basic auth: the browser supplies the prompt, we set the cookie once.
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
      response.cookies.set("unprompted_admin", secret, {
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

/** Length-independent comparison, so a wrong guess leaks no timing signal. */
function safeEqual(a: string, b: string): boolean {
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

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
