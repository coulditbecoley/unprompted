import type { Metadata } from "next";

import { CategoryBrowser } from "@/components/category-browser";
import { categoriesBySector } from "@/lib/categories";
import { latestRun, standings, consensus, consensusScore, allBrands } from "@/lib/data";

export function generateMetadata(): Metadata {
  const categories = categoriesBySector().flatMap(group => group.categories);
  const published = categories.filter(category => latestRun(category.slug));
  const title = "Browse AI brand charts by category";
  const description = `${published.length} of ${categories.length} categories have published results. See which brands lead and how often assistants agree on their first pick.`;
  return { title, description, alternates: { canonical: "/categories" }, openGraph: { title, description, url: "/categories", type: "website", siteName: "Unprompted" } };
}

export default function CategoriesPage() {
  const groups = categoriesBySector().map(group => ({
    ...group,
    categories: group.categories.map(category => ({
      ...category,
      keywords: [...category.keywords, ...allBrands(category.slug)],
    })),
  }));

  // Counts come from the data itself, so a category cannot advertise a chart
  // that does not exist.
  const counts: Record<string, { leader: string | null; share: number; measured: string; agreement: { settled: number; total: number } | null } | undefined> = {};
  for (const group of groups) {
    for (const category of group.categories) {
      const run = latestRun(category.slug);
      const leader = run ? standings(run)[0] : undefined;
      counts[category.slug] = run
        ? { leader: leader?.brand ?? null, share: leader?.firstShare ?? 0, measured: run.measured_on || run.run_date, agreement: run.engines.length > 1 ? consensusScore(consensus(run, {})) : null }
        : undefined;
    }
  }

  return (
    <section className="shell section categories-page">
      <p className="label">Browse</p>
      <h1 className="display page-title rise">
        What we measure.
      </h1>
      <p className="section-lead">
        Choose a category to see which brands AI assistants name first.
        Check the measurement date: the latest published answers may be weeks old.
      </p>
      <CategoryBrowser groups={groups} counts={counts} />
    </section>
  );
}
