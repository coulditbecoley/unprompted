import { notFound } from "next/navigation";
import { CATEGORIES, getCategory, getSector } from "@/lib/categories";
import { loadHistory } from "@/lib/data";
import { ChartBoard } from "@/components/chart-board";

export function generateStaticParams() {
  return CATEGORIES.flatMap(c => loadHistory(c.slug, true).map(r => ({ category: c.slug, date: r.run_date })));
}
export default async function DatedChart({ params }: { params: Promise<{ category: string; date: string }> }) {
  const { category, date } = await params;
  const meta = getCategory(category);
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  return <ChartBoard category={meta} sector={getSector(meta.sector)} date={date} />;
}
