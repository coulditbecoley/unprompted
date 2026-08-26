import type { MetadataRoute } from "next";

import { CATEGORIES } from "@/lib/categories";
import { allBrands, latestRun } from "@/lib/data";
import { slugify } from "@/lib/shared";

const SITE = "https://unprompted.report";

/**
 * Every page worth finding, generated from the data rather than listed.
 *
 * It exists because robots.txt points at it, and a robots file that advertises
 * a sitemap that is not there is a small lie told to every crawler that reads
 * it. It earns its place beyond that: the brand pages are the long tail of this
 * site and nothing links to all of them from one place.
 *
 * `lastModified` is the run date rather than the build date. A rebuild does not
 * change what a page says, and telling a crawler otherwise is how a site
 * teaches one to stop believing its dates.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const fixed = ["", "/chart", "/categories", "/compare", "/consensus", "/questions", "/methodology"];

  const entries: MetadataRoute.Sitemap = fixed.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

  for (const category of CATEGORIES) {
    const run = latestRun(category.slug);
    const lastModified = run ? new Date(run.run_date) : undefined;

    entries.push({
      url: `${SITE}/chart/${category.slug}`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.9,
    });

    for (const brand of allBrands(category.slug)) {
      entries.push({
        url: `${SITE}/brand/${category.slug}/${slugify(brand)}`,
        lastModified,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }

  return entries;
}
