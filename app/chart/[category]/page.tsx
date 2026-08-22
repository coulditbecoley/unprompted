import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CATEGORIES, getCategory, getSector } from "@/lib/categories";
import { ChartBoard } from "@/components/chart-board";

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
  return {
    title: meta.label,
    description: `${meta.question} Which brands AI assistants actually name, measured weekly and published in full.`,
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
