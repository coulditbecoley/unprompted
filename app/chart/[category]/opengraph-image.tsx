import { boardCard } from "@/app/opengraph-image";
import { CATEGORIES } from "@/lib/categories";

export const alt = "The latest board on Unprompted";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}

/** Each board's link previews its own leader, not the flagship's. */
export default async function Image({ params }: { params: Promise<{ category: string }> }) {
  return boardCard((await params).category);
}
