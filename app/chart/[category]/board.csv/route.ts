import { CATEGORIES } from "@/lib/categories";
import { latestRun, standings } from "@/lib/data";

/**
 * The latest board as a spreadsheet, for anyone who wants to check or chart
 * the figures themselves. Same numbers as the page: shares divide by answered
 * runs only. Built at deploy time, one file per category.
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(_req: Request, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  const run = latestRun(category);
  if (!run) return new Response("Not found", { status: 404 });

  const rows = [
    ["rank", "brand", "named_in", "answers", "named_share", "named_first", "first_share", "median_position", "measured_on", "published", "method_version"],
    ...standings(run).map((b, i) => [
      i + 1,
      b.brand,
      b.named,
      b.totalRuns,
      b.rotation.toFixed(4),
      b.firstNamed,
      b.firstShare.toFixed(4),
      b.medianPosition ?? "",
      run.measured_on || run.run_date,
      run.run_date,
      run.method_version,
    ]),
  ];
  return new Response(rows.map((r) => r.map(cell).join(",")).join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="unprompted-${category}-${run.run_date}.csv"`,
    },
  });
}
