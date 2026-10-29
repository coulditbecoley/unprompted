import { DEFAULT_CATEGORY } from "@/lib/categories";
import { categoryLabel, latestRun, answered, loadQuestionText } from "@/lib/data";
import { shareCard } from "@/app/compare/share-card";

export const alt = `Unprompted Questions: original answers and sources for ${categoryLabel(DEFAULT_CATEGORY)}.`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  const run = latestRun(DEFAULT_CATEGORY);
  const answers = run ? answered(run).length : 0;
  return shareCard({
    label: `Questions / Unfiltered default view / ${categoryLabel(DEFAULT_CATEGORY)}`,
    headline: run ? `${answers} answers to inspect.` : "Read the questions behind the chart.",
    detail: "Original answers and source links. Errors and refusals excluded from this count.",
    stats: run ? [["Questions in reading", String(Object.keys(loadQuestionText(DEFAULT_CATEGORY, run)).length)], ["Recorded attempts", String(run.extractions.length)], ["Assistants", String(run.engines.length)]] : [],
    footer: run ? `Measured ${run.measured_on || run.run_date} / Reading ${run.run_date}` : "No published answers yet",
  });
}
