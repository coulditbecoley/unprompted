import { DEFAULT_CATEGORY } from "@/lib/categories";
import { categoryLabel, latestRun, consensus, consensusScore } from "@/lib/data";
import { shareCard } from "@/app/compare/share-card";

export const alt = `Unprompted Consensus: on how many questions every assistant named the same brand first, for ${categoryLabel(DEFAULT_CATEGORY)}.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const run = latestRun(DEFAULT_CATEGORY);
  const score = run ? consensusScore(consensus(run, {})) : null;
  const available = run && run.engines.length >= 2 && score && score.total > 0;
  return shareCard({
    label: `Consensus / Default view / ${categoryLabel(DEFAULT_CATEGORY)}`,
    headline: available ? `Assistants agree on ${score.settled} of ${score.total} questions.` : "Not enough answers to compare agreement.",
    detail: "Agreement means every assistant names the same brand first.",
    stats: available ? [["Full agreement", `${Math.round(score.share * 100)}%`], ["Assistants compared", String(run.engines.length)]] : [],
    footer: run ? `Measured ${run.measured_on || run.run_date} / Published ${run.run_date}` : "No published results yet",
  });
}
