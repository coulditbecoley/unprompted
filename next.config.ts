import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The public surfaces are statically generated so crawlers and AI assistants
  // can read them. Being citable is a product goal, not a nice-to-have.
  outputFileTracingRoot: process.cwd(),
  // Held weeks are evidence for the operator, read only by /admin. Without
  // this every server function shipped all of data/held (two thirds of the
  // archive, growing every week) towards Vercel's function size limit.
  outputFileTracingExcludes: { "/**": ["./data/held/**/*"] },
  outputFileTracingIncludes: { "/admin": ["./data/held/**/*"] },
};

export default nextConfig;
