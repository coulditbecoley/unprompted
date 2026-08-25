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

import registry from "@/agents.json";

/**
 * The list lives in agents.json so the TypeScript that classifies a request and
 * the Python that archives the counts read the same one. They were two copies
 * for about an hour, which is an hour longer than two copies stay in step.
 *
 * Order is load-bearing and the file preserves it: the first match wins, so a
 * more specific token must come before the prefix it extends —
 * "Applebot-Extended" before "Applebot", "Claude-SearchBot" before "ClaudeBot".
 */
const AGENTS: Array<[RegExp, Agent]> = registry.agents.map((a) => [
  new RegExp(a.pattern, "i"),
  { name: a.name, vendor: a.vendor, purpose: a.purpose as AgentPurpose },
]);

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
