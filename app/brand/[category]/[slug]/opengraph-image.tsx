import { boardCard } from "@/app/opengraph-image";
import { CATEGORIES } from "@/lib/categories";
import { allBrands, slugify } from "@/lib/data";

export const alt = "How often AI assistants name this brand, on Unprompted";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return CATEGORIES.flatMap((c) =>
    allBrands(c.slug).map((brand) => ({ category: c.slug, slug: slugify(brand) })),
  );
}

/** A brand link previews that brand's own numbers. */
export default async function Image({ params }: { params: Promise<{ category: string; slug: string }> }) {
  const { category, slug } = await params;
  const brand = allBrands(category).find((b) => slugify(b) === slug);
  return boardCard(category, undefined, brand);
}
