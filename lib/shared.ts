/**
 * The parts of the data layer that carry no filesystem.
 *
 * `lib/data.ts` reads the repository at build time, so it imports `node:fs`.
 * That was fine while only server components touched it, and stopped being fine
 * the moment a client component needed a constant that happened to live beside
 * the loaders: the bundler followed the import and tried to put `node:fs` in the
 * browser.
 *
 * Anything here must stay pure — a constant, a string transform, a type. If a
 * thing needs to read a file, it belongs in `lib/data.ts`, which re-exports
 * everything below so existing server callers keep working unchanged.
 */

/** URL-safe form of a brand name. The inverse is a lookup, never a parse. */
export function slugify(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Plain-text form, for places that cannot carry a link (feeds, meta tags). */
export const DISCLOSURE =
  "Operated by Skald Studio, which sells AI visibility work. No placement on this chart is for sale.";

export const OPERATOR = "Skald Studio";
export const OPERATOR_URL = "https://skaldstudio.io";

/** A category label as it reads mid-sentence: "AI coding assistants" keeps its acronym. */
export function inSentence(label: string): string {
  // Word by word: acronyms ("AI", "SEO") stay, every other word drops its capital.
  return label
    .split(" ")
    .map((w) => (/^[A-Z0-9&]{2,}$/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1)))
    .join(" ");
}
