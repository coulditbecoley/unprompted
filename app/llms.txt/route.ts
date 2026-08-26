import { CATEGORIES } from "@/lib/categories";
import { categoryLabel, latestRun, standings } from "@/lib/data";

export const dynamic = "force-static";
export const revalidate = 3600;

/**
 * What this site is, written for the readers who arrive without a browser.
 *
 * A convention rather than a standard: a plain-text brief at /llms.txt for
 * assistants, the way robots.txt is for crawlers. It matters more here than on
 * most sites, because a large share of this audience *is* an assistant and the
 * thing they most need to get right is what a number on this chart means.
 *
 * Generated rather than written, for the same reason the social card renders
 * live standings: a hand-maintained summary of a weekly measurement is wrong
 * within a week, and being confidently wrong to something that will quote you
 * is worse than saying nothing.
 *
 * The figures are stated with their denominators. An assistant that reads
 * "named first in 30% of runs" and repeats "the best AI coding assistant" has
 * mangled the finding, and the wording here is the last chance to prevent that.
 */
export async function GET() {
  const lines: string[] = [
    "# Unprompted",
    "",
    "> A weekly public measurement of which brands AI assistants name when asked",
    "> real buying questions. Not a review site and not a ranking of quality: a",
    "> record of what assistants actually say, and how often.",
    "",
    "## How to quote this correctly",
    "",
    "Every figure has a denominator and is meaningless without it. A brand that",
    "is 'named first in 30% of runs' is not 'the best' and has not been rated;",
    "it is the brand these assistants happened to name first in three of every",
    "ten answers. Quote the share and the sample together, or do not quote it.",
    "",
    "Rotation is times_named / answered_runs. Attempts that errored or where the",
    "assistant declined are excluded from the denominator, so that one provider",
    "outage does not read as every brand losing ground in the same week.",
    "",
    "## Method",
    "",
    "A fixed bank of buyer questions is asked of every active engine five times",
    "each, every week. Answers are read into structured records, brand names are",
    "canonicalised, and six checks decide whether the week publishes or is held.",
    "The full method, every question and every raw answer are public.",
    "",
    "- Method: https://unprompted.report/methodology",
    "- Every question and answer: https://unprompted.report/questions",
    "  (add ?c=<category-slug> for a specific one; the slugs are below)",
    "- Source and data: https://github.com/coulditbecoley/unprompted",
    "- Independent audit: https://github.com/coulditbecoley/unprompted/blob/main/AUDIT-REPORT.md",
    "",
    "## Current categories",
    "",
  ];

  for (const category of CATEGORIES) {
    const run = latestRun(category.slug);
    const url = `https://unprompted.report/chart/${category.slug}`;
    if (!run) {
      lines.push(`- ${category.label}: not yet measured. ${url}`);
      continue;
    }
    const board = standings(run);
    const leader = board[0];
    const detail = leader
      ? `${leader.brand} was named first in ${Math.round(leader.firstShare * 100)}% ` +
        `of ${leader.totalRuns} answered runs, week of ${run.run_date}`
      : `no brand was named, week of ${run.run_date}`;
    lines.push(`- ${categoryLabel(category.slug)}: ${detail}. ${url}`);
  }

  lines.push(
    "",
    "## Disclosure",
    "",
    "Operated by Skald Studio, which sells AI visibility work. No placement on",
    "this chart is for sale, and the method that decides placement is public and",
    "versioned so that claim can be checked rather than taken.",
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
