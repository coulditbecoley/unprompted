import type { Extraction } from "@/lib/metrics";

export function firstPickSummary(rows: Extraction[]): string {
  const answers = rows.filter(row => !row.error && !row.refused);
  if (!answers.length) return "No answers with these filters; no first pick to compare.";
  const population = `${answers.length} ${answers.length === 1 ? "answer" : "answers"}`;
  const counts = new Map<string, number>();
  for (const answer of answers) {
    const first = answer.brands.find(brand => brand.position === 1);
    if (first) counts.set(first.name, (counts.get(first.name) ?? 0) + 1);
  }
  if (!counts.size) return `No brand was named first in ${population} with these filters.`;
  const most = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => count === most).map(([name]) => name).sort();
  const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(leaders);
  return leaders.length === 1
    ? `Named first most often: ${names} (${most} of ${population} with these filters).`
    : `Tied for most first picks: ${names} (${most} each out of ${population} with these filters).`;
}
