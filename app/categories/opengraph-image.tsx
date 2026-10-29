import { CATEGORIES } from "@/lib/categories";
import { latestRun, standings } from "@/lib/data";
import { shareCard } from "@/app/compare/share-card";

export const alt = "Unprompted Categories: published AI brand charts and their current first-pick leaders.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const published = CATEGORIES.flatMap(category => {
    const run = latestRun(category.slug);
    return run ? [{ category, run, leader: standings(run)[0] }] : [];
  });
  return shareCard({
    label: "Categories / Latest published readings",
    headline: `${published.length} of ${CATEGORIES.length} categories have results.`,
    detail: "See which brands AI assistants name first.",
    stats: published.slice(0, 3).map(({ category, run, leader }) => [
      `${category.label} / ${run.measured_on || run.run_date}`,
      leader ? `${leader.brand} / ${Math.round(leader.firstShare * 100)}%` : "No brand named",
    ]),
    footer: "First-pick shares / Measurement dates shown per category",
  });
}
