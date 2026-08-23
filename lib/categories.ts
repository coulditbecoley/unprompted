/**
 * The category registry.
 *
 * One place to add a category, so growing the publication is a data change
 * rather than a code change. The pipeline already takes --category and reads
 * questions/<slug>.yml and aliases/<slug>.yml, so adding an entry here plus
 * those two files is the entire job.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES A CATEGORY WORK HERE
 *
 * The hard filter is that the buying question must return **a list of
 * companies**. Plenty of large sectors fail it:
 *
 *   Electronics  — "best noise-cancelling headphones" returns *products*
 *                  (Sony XM6, AirPods Pro), and three giants own the field.
 *                  A chart of Sony vs Bose vs Apple never moves.
 *   Gardening    — brand-shaped but tiny brands, low stakes, and nobody is
 *                  arguing about it.
 *   Art          — mostly taste, and the answers are techniques and materials
 *                  rather than companies you choose between.
 *   Manufacturing— genuinely brand-shaped, but answers are regional, so one
 *                  national chart would be measuring noise.
 *
 * What passes: a finite set of *companies*, a real argument, money at stake,
 * and enough mid-size players that the field can actually shift.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY CATEGORY HERE IS AN AI CATEGORY
 *
 * These are the only fields where the engines we query also sell the products
 * being ranked, which is the one measurement no competing tool can produce.
 *
 * The design needs at least one engine with no stake, or the rival baseline the
 * self-preference gap is measured against is itself contaminated. That is why
 * AI search tools are deliberately absent: all three of our engines compete
 * there, so there would be no clean comparison left. Image generation is the
 * strongest case in the set — only OpenAI competes, leaving two neutral
 * engines.
 *
 * ---------------------------------------------------------------------------
 * THE COST OF A CATEGORY
 *
 * Every live category is ~225 engine calls a week, plus alias curation and
 * quarantine review. It is not free and it does not amortise. Add them as they
 * earn their place, not to fill the page.
 *
 * `status` is honest, not aspirational. A category is `live` only once it has
 * measured data. Nothing here advertises a chart that does not exist.
 */

export type CategoryStatus = "live" | "planned";

export type Sector = {
  slug: string;
  label: string;
  blurb: string;
};

export type Category = {
  slug: string;
  label: string;
  sector: string;
  /** What a buyer is actually trying to decide. */
  question: string;
  status: CategoryStatus;
  /** Search terms beyond the label, so a visitor's word finds the category. */
  keywords: string[];
};

export const SECTORS: Sector[] = [
  {
    slug: "ai-software",
    label: "AI & Software",
    blurb:
      "The tools people ask an AI to recommend, including other AIs. The only field where the engines we query have a stake in the answer.",
  },
];

export const CATEGORIES: Category[] = [
  {
    slug: "ai-coding-assistants",
    label: "AI Coding Assistants",
    sector: "ai-software",
    question: "Which AI should I write code with?",
    status: "live",
    keywords: [
      "claude code", "copilot", "cursor", "codex", "windsurf", "cline", "aider",
      "coding", "developer", "ide", "agent", "programming",
    ],
  },
  {
    slug: "ai-writing-tools",
    label: "AI Writing Tools",
    sector: "ai-software",
    question: "Which AI should I write with?",
    status: "planned",
    keywords: [
      "chatgpt", "claude", "gemini", "jasper", "copy ai", "writesonic",
      "grammarly", "notion ai", "writing", "copywriting", "editing",
    ],
  },
  {
    slug: "ai-image-generators",
    label: "AI Image Generators",
    sector: "ai-software",
    question: "Which AI should I make images with?",
    status: "planned",
    keywords: [
      "midjourney", "dall-e", "stable diffusion", "flux", "ideogram", "firefly",
      "imagen", "leonardo", "recraft", "image", "art", "design", "logo",
    ],
  },
];

/** The category the bare /chart route resolves to. */
export const DEFAULT_CATEGORY = "ai-coding-assistants";

export function getCategory(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function liveCategories(): Category[] {
  return CATEGORIES.filter((c) => c.status === "live");
}

export function getSector(slug: string): Sector | undefined {
  return SECTORS.find((s) => s.slug === slug);
}

export function categoriesBySector(): Array<{ sector: Sector; categories: Category[] }> {
  return SECTORS.map((sector) => ({
    sector,
    categories: CATEGORIES.filter((c) => c.sector === sector.slug),
  })).filter((group) => group.categories.length > 0);
}

/**
 * Matches a visitor's words against label, sector, question and keywords.
 * Deliberately a plain substring match: with a handful of categories, anything
 * cleverer is machinery in search of a problem.
 */
export function matchesQuery(category: Category, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const sector = getSector(category.sector);
  const haystack = [
    category.label,
    category.slug,
    category.question,
    sector?.label ?? "",
    ...category.keywords,
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}
