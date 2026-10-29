import type { Metadata } from "next";

import { CategoryBrowser } from "@/components/category-browser";
import { categoriesBySector } from "@/lib/categories";
import { latestRun, standings } from "@/lib/data";

export const metadata: Metadata = {
  title: "Categories",
  description:
    "Every category Unprompted measures, grouped by sector. Which brands AI assistants name when people ask what to buy.",
  openGraph: { title: "Browse AI brand charts", description: "See the leading brand, first-pick share, and measurement date for each category." },
};

export default function CategoriesPage() {
  const groups = categoriesBySector();

  // Counts come from the data itself, so a category cannot advertise a chart
  // that does not exist.
  const counts: Record<string, { leader: string | null; share: number; measured: string } | undefined> = {};
  for (const group of groups) {
    for (const category of group.categories) {
      const run = latestRun(category.slug);
      const leader = run ? standings(run)[0] : undefined;
      counts[category.slug] = run
        ? { leader: leader?.brand ?? null, share: leader?.firstShare ?? 0, measured: run.measured_on || run.run_date }
        : undefined;
    }
  }

  return (
    <section className="shell section">
      <p className="label">Browse</p>
      <h1 className="display page-title rise">
        What we measure.
      </h1>
      <p className="section-lead">
        Choose a category to see which brands AI assistants mention in answers
        to buying questions. We attempt a measurement each week and publish only
        results that pass our checks.
      </p>
      <CategoryBrowser groups={groups} counts={counts} />
    </section>
  );
}
