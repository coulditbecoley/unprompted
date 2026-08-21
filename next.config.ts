import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The public surfaces are statically generated so crawlers and AI assistants
  // can read them. Being citable is a product goal, not a nice-to-have.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
