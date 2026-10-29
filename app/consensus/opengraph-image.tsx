import { DEFAULT_CATEGORY } from "@/lib/categories";
import { categoryLabel, latestRun, consensus, consensusScore } from "@/lib/data";
import { shareCard } from "@/app/compare/share-card";

export const alt = "Unprompted Consensus: how many questions have full agreement in the default category.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const run = latestRun(DEFAULT_CATEGORY);
  const score = run ? consensusScore(consensus(run, {})) : null;
  const available = run && run.engines.length >= 2 && score && score.total > 0;
  return shareCard({
    label: `Consensus / Default view / ${categoryLabel(DEFAULT_CATEGORY)}`,
    headline: available ? `Assistants agree on ${score.settled} of ${score.total} questions.` : "Not enough answers to compare agreement.",
    detail: "Agreement means every assistant has the same unique first pick.",
    stats: available ? [["Full agreement", `${Math.round(score.share * 100)}%`], ["Assistants compared", String(run.engines.length)]] : [],
    footer: run ? `Measured ${run.measured_on || run.run_date} / Reading ${run.run_date}` : "No published reading yet",
  });
}
