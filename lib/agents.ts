/**
 * Who is reading this, and on whose behalf.
 *
 * The reason this file exists: a JavaScript analytics beacon cannot see an AI
 * agent. GPTBot, ClaudeBot and PerplexityBot fetch the HTML and leave without
 * running a line of script, so every client-side product — Vercel Web
 * Analytics, Plausible, PostHog, GA — reports zero of them. The only place they
 * are visible is the request itself, which is why this is read in `proxy.ts`.
 *
 * The distinction that matters here is not bot versus human. It is **why** the
 * fetch happened:
 *
 *   live      a person asked an assistant a question and it read this page to
 *             answer them. For a publication about what assistants recommend,
 *             this is the whole point: it is the moment the chart entered an
 *             answer somebody actually received.
 *   training  a crawler collecting pages to train on or index for later. Also
 *             worth knowing, and a completely different fact.
 *   search    a conventional search crawler.
 *
 * Conflating those three would waste the measurement. One ChatGPT-User hit is
 * more interesting than a thousand from GPTBot.
 *
 * User agents are self-declared and trivially forged. Nothing here is a
 * security control; it is a reading of what the client says it is, and the
 * dashboard says so.
 */

export type AgentPurpose = "live" | "training" | "search";

export type Agent = {
  /** The token as the vendor documents it, used as the storage key. */
  name: string;
  vendor: string;
  purpose: AgentPurpose;
};

/**
 * Order is load-bearing: the first match wins, so a more specific token must
 * come before the prefix it extends. "Applebot-Extended" before "Applebot",
 * "Claude-SearchBot" before "ClaudeBot".
 */
const AGENTS: Array<[RegExp, Agent]> = [
  // --- OpenAI ---
  [/ChatGPT-User/i, { name: "ChatGPT-User", vendor: "OpenAI", purpose: "live" }],
  [/OAI-SearchBot/i, { name: "OAI-SearchBot", vendor: "OpenAI", purpose: "search" }],
  [/GPTBot/i, { name: "GPTBot", vendor: "OpenAI", purpose: "training" }],

  // --- Anthropic ---
  [/Claude-User/i, { name: "Claude-User", vendor: "Anthropic", purpose: "live" }],
  [/Claude-SearchBot/i, { name: "Claude-SearchBot", vendor: "Anthropic", purpose: "search" }],
  [/ClaudeBot/i, { name: "ClaudeBot", vendor: "Anthropic", purpose: "training" }],
  [/anthropic-ai/i, { name: "anthropic-ai", vendor: "Anthropic", purpose: "training" }],

  // --- Perplexity ---
  [/Perplexity-User/i, { name: "Perplexity-User", vendor: "Perplexity", purpose: "live" }],
  [/PerplexityBot/i, { name: "PerplexityBot", vendor: "Perplexity", purpose: "search" }],

  // --- Google ---
  [/Google-Extended/i, { name: "Google-Extended", vendor: "Google", purpose: "training" }],
  [/GoogleOther/i, { name: "GoogleOther", vendor: "Google", purpose: "training" }],
  [/Googlebot/i, { name: "Googlebot", vendor: "Google", purpose: "search" }],

  // --- Microsoft ---
  [/BingPreview/i, { name: "BingPreview", vendor: "Microsoft", purpose: "search" }],
  [/bingbot/i, { name: "bingbot", vendor: "Microsoft", purpose: "search" }],

  // --- everyone else ---
  [/DuckAssistBot/i, { name: "DuckAssistBot", vendor: "DuckDuckGo", purpose: "live" }],
  [/MistralAI-User/i, { name: "MistralAI-User", vendor: "Mistral", purpose: "live" }],
  [/YouBot/i, { name: "YouBot", vendor: "You.com", purpose: "search" }],
  [/Applebot-Extended/i, { name: "Applebot-Extended", vendor: "Apple", purpose: "training" }],
  [/Applebot/i, { name: "Applebot", vendor: "Apple", purpose: "search" }],
  [/meta-externalagent/i, { name: "meta-externalagent", vendor: "Meta", purpose: "training" }],
  [/FacebookBot/i, { name: "FacebookBot", vendor: "Meta", purpose: "training" }],
  [/Amazonbot/i, { name: "Amazonbot", vendor: "Amazon", purpose: "search" }],
  [/Bytespider/i, { name: "Bytespider", vendor: "ByteDance", purpose: "training" }],
  [/CCBot/i, { name: "CCBot", vendor: "Common Crawl", purpose: "training" }],
  [/cohere-ai|cohere-training-data-crawler/i, { name: "cohere-ai", vendor: "Cohere", purpose: "training" }],
  [/Diffbot/i, { name: "Diffbot", vendor: "Diffbot", purpose: "training" }],
  [/ImagesiftBot/i, { name: "ImagesiftBot", vendor: "Imagesift", purpose: "training" }],
  [/Timpibot/i, { name: "Timpibot", vendor: "Timpi", purpose: "training" }],
  [/omgili/i, { name: "Omgilibot", vendor: "Webz.io", purpose: "training" }],
  [/DataForSeoBot/i, { name: "DataForSeoBot", vendor: "DataForSEO", purpose: "search" }],
  [/SemrushBot/i, { name: "SemrushBot", vendor: "Semrush", purpose: "search" }],
  [/AhrefsBot/i, { name: "AhrefsBot", vendor: "Ahrefs", purpose: "search" }],
];

/**
 * Generic automation that declares itself but is nobody's product: curl, wget,
 * python-requests, headless scrapers. Recorded as one bucket rather than
 * enumerated, because the long tail is infinite and none of it is interesting
 * individually.
 */
const GENERIC = /bot\b|crawler|spider|scrape|curl\/|wget|python-requests|axios\/|node-fetch|Go-http-client|okhttp|libwww|HeadlessChrome/i;

/** A named agent, the generic bucket, or null for something that looks human. */
export function identifyAgent(userAgent: string | null): Agent | null {
  if (!userAgent) {
    // No user agent at all is not a browser. Worth counting rather than
    // discarding: it is the signature of a plain scripted fetch.
    return { name: "(no user agent)", vendor: "unknown", purpose: "training" };
  }
  for (const [pattern, agent] of AGENTS) {
    if (pattern.test(userAgent)) return agent;
  }
  if (GENERIC.test(userAgent)) {
    return { name: "other automation", vendor: "unknown", purpose: "training" };
  }
  return null;
}

/** Every agent this build knows how to name, for the dashboard's own legend. */
export function knownAgents(): Agent[] {
  return AGENTS.map(([, agent]) => agent);
}
