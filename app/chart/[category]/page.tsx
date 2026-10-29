import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CATEGORIES, getCategory, getSector } from "@/lib/categories";
import { ChartBoard } from "@/components/chart-board";
import { latestRun, standings } from "@/lib/data";

/** Every category gets a permanent, statically generated URL. */
export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const meta = getCategory(category);
  if (!meta) return { title: "Unknown category" };
  // The verdict goes in the title and description, because that line is what
  // a search result or a shared link shows before anyone clicks.
  const run = latestRun(category);
  const top = run ? standings(run)[0] : undefined;
  const title = top ? `${meta.label}: ${top.brand} named first in ${Math.round(top.firstShare * 100)}% of AI answers` : meta.label;
  const description = top && run
    ? `${meta.question} We asked ${run.engines.length} AI assistants and counted every brand they named. ${top.brand} was named first most often, in ${Math.round(top.firstShare * 100)}% of answers measured ${run.measured_on || run.run_date}. Method and raw answers are public.`
    : `${meta.question} Which brands AI assistants actually name, measured weekly and published in full.`;
  const url = `https://unprompted.report/chart/${category}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", siteName: "Unprompted" },
  };
}

export default async function CategoryChartPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const meta = getCategory(category);
  if (!meta) notFound();

  return <ChartBoard category={meta} sector={getSector(meta.sector)} />;
}
