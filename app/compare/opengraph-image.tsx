import { DEFAULT_CATEGORY } from "@/lib/categories";
import { categoryLabel, latestRun, standings } from "@/lib/data";
import { shareCard } from "./share-card";

export const alt = "Unprompted Compare: the default category's top two brands and their first-pick shares.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const run = latestRun(DEFAULT_CATEGORY);
  const pair = run ? standings(run).slice(0, 2) : [];
  return shareCard({
    label: `Compare / Default view / ${categoryLabel(DEFAULT_CATEGORY)}`,
    headline: pair.length === 2 ? `${pair[0].brand} vs ${pair[1].brand}` : "Compare brands in AI answers.",
    detail: pair.length === 2 ? `Named first, out of ${pair[0].totalRuns} answers. Errors and refusals excluded.` : "Not enough published brands to compare yet.",
    stats: pair.map(b => [b.brand, `${Math.round(b.firstShare * 100)}% named first`]),
    footer: run ? `Measured ${run.measured_on || run.run_date} / Reading ${run.run_date}` : "No published reading yet",
  });
}
