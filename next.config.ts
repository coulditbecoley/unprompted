import type { NextConfig } from "next";

// Every server route except /admin and /api/admin/*, the only readers of held
// weeks. Listed rather than negated: Next applies excludes after includes, so
// "/**" plus an /admin include strips /admin too, and this build ignores a
// negated key. A new public route that loads data belongs here.
const PUBLIC_ROUTES = ["/brand/**", "/categories", "/chart", "/chart/**", "/compare", "/consensus", "/questions", "/methodology", "/feed.xml", "/llms.txt", "/opengraph-image", "/sitemap.xml", "/standings/**", "/_not-found"];
const HELD = ["./data/held/**/*"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The public surfaces are statically generated so crawlers and AI assistants
  // can read them. Being citable is a product goal, not a nice-to-have.
  outputFileTracingRoot: process.cwd(),
  // Held weeks are evidence for the operator, read only by /admin. Without
  // this every server function shipped all of data/held (two thirds of the
  // archive, growing every week) towards Vercel's function size limit.
  // One exclude whose key skips the admin routes. An include cannot re-add
  // them: Next applies excludes after includes (collect-build-traces.js), so
  // "/**" plus an /admin include would have shipped /admin with no held weeks.
  outputFileTracingExcludes: Object.fromEntries(PUBLIC_ROUTES.map((route) => [route, HELD])),
};

export default nextConfig;
