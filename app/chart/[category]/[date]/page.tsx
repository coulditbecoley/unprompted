import { notFound } from "next/navigation";
import { CATEGORIES, getCategory, getSector } from "@/lib/categories";
import { loadHistory } from "@/lib/data";
import { ChartBoard } from "@/components/chart-board";

export function generateStaticParams() {
  return CATEGORIES.flatMap(c => loadHistory(c.slug, true).map(r => ({ category: c.slug, date: r.run_date })));
}
export async function generateMetadata({ params }: { params: Promise<{ category: string; date: string }> }): Promise<Metadata> {
  const { category, date } = await params;
  const meta = getCategory(category);
  const run = meta && loadHistory(category, true).find(r => r.run_date === date);
  if (!meta || !run) notFound();
  const title = `${meta.label} · ${date}`;
  const description = `${meta.label}, measured on ${run.measured_on || run.run_date}. Published reading ${run.run_date}; methodology version ${run.method_version}. Rankings and supporting answers are public.`;
  const url = `/chart/${category}/${date}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website", siteName: "Unprompted" },
  };
}
export default async function DatedChart({ params }: { params: Promise<{ category: string; date: string }> }) {
  const { category, date } = await params;
  const meta = getCategory(category);
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  return <ChartBoard category={meta} sector={getSector(meta.sector)} date={date} />;
}
import type { Metadata } from "next";
