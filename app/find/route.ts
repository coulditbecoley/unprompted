import { redirect } from "next/navigation";

import { CATEGORIES } from "@/lib/categories";
import { allBrands, latestRun, standings } from "@/lib/data";
import { slugify } from "@/lib/shared";

/**
 * The homepage brand finder posts here, so it works without JavaScript.
 * An exact name (any case) goes to that brand's page, preferring a category
 * where it is on the latest board; anything else becomes a category search.
 */
export function GET(request: Request) {
  const raw = (new URL(request.url).searchParams.get("b") ?? "").trim();
  const q = raw.toLowerCase();
  if (q) {
    const hits = CATEGORIES.flatMap((c) =>
      allBrands(c.slug)
        .filter((b) => b.toLowerCase() === q)
        .map((b) => {
          const run = latestRun(c.slug);
          const onBoard = run ? standings(run).some((s) => s.brand === b) : false;
          return { category: c.slug, brand: b, onBoard };
        }),
    );
    const best = hits.find((h) => h.onBoard) ?? hits[0];
    if (best) redirect(`/brand/${best.category}/${slugify(best.brand)}`);
  }
  // No exact match: hand the words to the category search, which says plainly
  // when nothing matches rather than leaving the reader guessing.
  redirect(raw ? `/categories?${new URLSearchParams({ q: raw.slice(0, 80) })}` : "/categories");
}
