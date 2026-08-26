import type { MetadataRoute } from "next";

/**
 * Who may read this, which for this publication is everybody.
 *
 * A site that measures what AI assistants recommend has no business blocking AI
 * assistants from reading it. Being crawled, quoted and cited is the point, and
 * the audience dashboard exists to count exactly that. So there is no
 * AI-specific disallow here and there deliberately never will be one without a
 * reason written down beside it.
 *
 * Only the two surfaces that are nobody's business are closed: the operator's
 * admin, and the API routes behind it. Both are already gated by `proxy.ts`;
 * this is the polite notice rather than the lock.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/"],
      },
    ],
    sitemap: "https://unprompted.report/sitemap.xml",
    host: "https://unprompted.report",
  };
}
