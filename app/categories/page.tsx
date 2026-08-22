import type { Metadata } from "next";

import { CategoryBrowser } from "@/components/category-browser";
import { categoriesBySector } from "@/lib/categories";
import { latestRun, loadHistory, standings } from "@/lib/data";

export const metadata: Metadata = {
  title: "Categories",
  description:
    "Every category Unprompted measures, grouped by sector. Which brands AI assistants name when people ask what to buy.",
};

export default function CategoriesPage() {
  const groups = categoriesBySector();

  // Counts come from the data itself, so a category cannot advertise a chart
  // that does not exist.
  const counts: Record<string, { brands: number; weeks: number } | undefined> = {};
  for (const group of groups) {
    for (const category of group.categories) {
      const run = latestRun(category.slug);
      counts[category.slug] = run
        ? { brands: standings(run).length, weeks: loadHistory(category.slug).length }
        : undefined;
    }
  }

  return (
    <section className="shell section">
      <p className="label">Browse</p>
      <h1 style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, margin: "6px 0 12px" }}>
        What we measure.
      </h1>
      <p className="section-lead">
        Every category is a real buying question, asked of the AI assistants
        {" "}every week and published in full. We add them one at a time and only
        list one as measured once it has data.
      </p>

      <CategoryBrowser groups={groups} counts={counts} />
    </section>
  );
}
