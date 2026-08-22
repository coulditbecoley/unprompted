/**
 * The category registry.
 *
 * One place to add a category, so growing the publication is a data change
 * rather than a code change. The pipeline already takes --category and reads
 * questions/<slug>.yml and aliases/<slug>.yml, so adding an entry here plus
 * those two files is the entire job.
 *
 * Sectors exist because "Pokémon card grading" is not a peer of "card sleeves"
 * — they are two questions inside one hobby, and a visitor arriving at the site
 * needs to see that shape before they see fifteen slugs.
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
    slug: "collectibles",
    label: "Collectibles",
    blurb:
      "Trading cards and the services around them: who grades, who sells, and what protects what you own.",
  },
];

export const CATEGORIES: Category[] = [
  {
    slug: "pokemon-grading",
    label: "Pokémon Card Grading",
    sector: "collectibles",
    question: "Which company should I send my cards to?",
    status: "live",
    keywords: ["psa", "cgc", "beckett", "bgs", "tag", "sgc", "slab", "grade", "grading", "pokemon", "tcg"],
  },
  {
    slug: "card-supplies",
    label: "Card Supplies",
    sector: "collectibles",
    question: "What should I store and protect my cards in?",
    status: "planned",
    keywords: ["sleeves", "binder", "toploader", "ultra pro", "dragon shield", "vault x", "gamegenic", "bcw", "storage"],
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
