import { CATEGORIES } from "@/lib/categories";
import { categoryLabel, latestRun, standings } from "@/lib/data";

export const dynamic = "force-static";
export const revalidate = 3600;

/**
 * The latest board for one category as small JSON, for readers that count
 * rather than quote: assistants, agents and scripts. /llms.txt links these.
 *
 * The raw weekly record is about 1.5 MB of answers and is the evidence; this
 * is the summary the chart draws, with every share's denominator beside it so
 * it cannot be quoted without one. Static: rebuilt with the site each week.
 */
export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ file: `${c.slug}.json` }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const category = CATEGORIES.find((c) => `${c.slug}.json` === file);
  const run = category ? latestRun(category.slug) : null;
  if (!category || !run) return Response.json({ error: "unknown or unmeasured category" }, { status: 404 });
  const week = run.measured_on || run.run_date;
  const board = standings(run);
  const body = {
    category: category.slug,
    label: categoryLabel(category.slug),
    week,
    reading: run.run_date,
    method_version: run.method_version,
    engines: run.engines,
    answered_runs: board[0]?.totalRuns ?? 0,
    how_to_quote:
      "Shares are of answered runs (errors and refusals excluded). Quote a share with its denominator; " +
      "a brand named first more often has not been rated better.",
    brands: board.map((b, i) => ({
      rank: i + 1,
      brand: b.brand,
      named: b.named,
      named_share: Math.round(b.rotation * 10_000) / 10_000,
      first: b.firstNamed,
      first_share: Math.round(b.firstShare * 10_000) / 10_000,
      of: b.totalRuns,
    })),
    chart: `https://unprompted.report/chart/${category.slug}`,
    method: "https://unprompted.report/methodology",
    raw: `https://raw.githubusercontent.com/coulditbecoley/unprompted/main/data/runs/${run.run_date}/${category.slug}.json`,
  };
  return Response.json(body, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
