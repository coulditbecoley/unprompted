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
      "The tools people ask an AI to recommend, including other AIs. The one place we can ask whether an assistant favours its own side.",
  },
  {
    slug: "money-business",
    label: "Money & Business",
    blurb:
      "The services a small business signs up for once and lives with for years. High stakes, heavy marketing, genuinely contested.",
  },
  {
    slug: "web-infrastructure",
    label: "Web & Hosting",
    blurb:
      "The most affiliate-saturated corner of the internet, where almost every human recommendation is bought.",
  },
  {
    slug: "collectibles",
    label: "Collectibles",
    blurb:
      "Trading cards and the services around them: who grades, who sells, and what protects what you own.",
  },
  {
    slug: "home-office",
    label: "Home & Office",
    blurb:
      "Direct-to-consumer categories where a handful of brands spend heavily to be the default answer.",
  },
];

export const CATEGORIES: Category[] = [
  // --- AI & Software -------------------------------------------------------
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
    keywords: ["chatgpt", "claude", "jasper", "copy ai", "writesonic", "grammarly", "writing", "copywriting"],
  },
  {
    slug: "crm-small-business",
    label: "Small Business CRM",
    sector: "ai-software",
    question: "Where should I keep my customers and deals?",
    status: "planned",
    keywords: ["hubspot", "salesforce", "pipedrive", "zoho", "attio", "folk", "crm", "sales", "pipeline"],
  },

  // --- Money & Business ----------------------------------------------------
  {
    slug: "business-banking",
    label: "Business Bank Accounts",
    sector: "money-business",
    question: "Where should my business bank?",
    status: "planned",
    keywords: ["mercury", "novo", "bluevine", "relay", "chase", "brex", "ramp", "banking", "business account"],
  },
  {
    slug: "payroll-software",
    label: "Payroll Software",
    sector: "money-business",
    question: "Who should run my payroll?",
    status: "planned",
    keywords: ["gusto", "adp", "paychex", "rippling", "justworks", "onpay", "payroll", "hr"],
  },

  // --- Web & Hosting -------------------------------------------------------
  {
    slug: "web-hosting",
    label: "Web Hosting",
    sector: "web-infrastructure",
    question: "Where should I host my site?",
    status: "planned",
    keywords: ["vercel", "netlify", "bluehost", "siteground", "hostinger", "cloudflare", "wp engine", "hosting"],
  },
  {
    slug: "vpn-services",
    label: "VPN Services",
    sector: "web-infrastructure",
    question: "Which VPN should I actually trust?",
    status: "planned",
    keywords: ["nordvpn", "expressvpn", "surfshark", "mullvad", "proton", "privacy", "vpn"],
  },

  // --- Collectibles --------------------------------------------------------
  {
    slug: "pokemon-grading",
    label: "Pokémon Card Grading",
    sector: "collectibles",
    question: "Which company should I send my cards to?",
    status: "live",
    keywords: ["psa", "cgc", "beckett", "bgs", "tag", "sgc", "slab", "grade", "grading", "pokemon", "tcg"],
  },
  {
    slug: "sports-card-grading",
    label: "Sports Card Grading",
    sector: "collectibles",
    question: "Which company should I send my sports cards to?",
    status: "planned",
    keywords: ["psa", "sgc", "beckett", "bgs", "cgc", "sports", "baseball", "basketball", "grading"],
  },
  {
    slug: "card-supplies",
    label: "Card Supplies",
    sector: "collectibles",
    question: "What should I store and protect my cards in?",
    status: "planned",
    keywords: ["sleeves", "binder", "toploader", "ultra pro", "dragon shield", "vault x", "gamegenic", "bcw", "storage"],
  },

  // --- Home & Office -------------------------------------------------------
  {
    slug: "standing-desks",
    label: "Standing Desks",
    sector: "home-office",
    question: "Which standing desk is worth the money?",
    status: "planned",
    keywords: ["uplift", "fully", "autonomous", "flexispot", "vari", "desk", "ergonomic", "office"],
  },
];

/** The category the bare /chart route resolves to. */
export const DEFAULT_CATEGORY = "pokemon-grading";

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
