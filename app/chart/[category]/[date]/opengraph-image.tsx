import { boardCard } from "@/app/opengraph-image";
import { CATEGORIES } from "@/lib/categories";
import { loadHistory } from "@/lib/data";

export const alt = "A dated board on Unprompted";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return CATEGORIES.flatMap((c) => loadHistory(c.slug, true).map((r) => ({ category: c.slug, date: r.run_date })));
}

export default async function Image({ params }: { params: Promise<{ category: string; date: string }> }) {
  const { category, date } = await params;
  return boardCard(category, date);
}
