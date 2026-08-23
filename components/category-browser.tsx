"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  type Category,
  type Sector,
  matchesQuery,
} from "@/lib/categories";

/**
 * Browse and search the categories.
 *
 * Search is a plain client-side substring filter. With a handful of categories
 * anything cleverer is machinery in search of a problem, and this stays useful
 * up to a few dozen. The moment it stops being enough, that is a real signal
 * the publication has grown, not a reason to build a search index today.
 */
export function CategoryBrowser({
  groups,
  counts,
}: {
  groups: Array<{ sector: Sector; categories: Category[] }>;
  counts: Record<string, { brands: number; weeks: number } | undefined>;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({
          sector: group.sector,
          categories: group.categories.filter((c) => matchesQuery(c, query)),
        }))
        .filter((group) => group.categories.length > 0),
    [groups, query],
  );

  const total = filtered.reduce((n, g) => n + g.categories.length, 0);

  return (
    <>
      <div className="cat-search">
        <label htmlFor="cat-q" className="sr-only">
          Search categories
        </label>
        <input
          id="cat-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: grading, sleeves, PSA…"
          className="cat-search-input mono"
          autoComplete="off"
        />
        <span className="cat-search-count mono" aria-live="polite">
          {total} {total === 1 ? "category" : "categories"}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="panel" style={{ paddingLeft: 22 }}>
          <p style={{ margin: 0, color: "var(--fg-2)" }}>
            Nothing matches &ldquo;{query}&rdquo;. We measure a small number of
            categories deliberately, and add them one at a time.
          </p>
        </div>
      )}

      {filtered.map(({ sector, categories }) => (
        <section key={sector.slug} className="cat-sector">
          <div className="cat-sector-head">
            <h2>{sector.label}</h2>
            <p>{sector.blurb}</p>
          </div>

          <div className="cat-grid">
            {categories.map((category) => {
              const stat = counts[category.slug];
              // Live means measured. The presence of a run is the only
              // evidence for that, so it is the only thing consulted.
              const live = Boolean(stat);

              const inner = (
                <>
                  <span className="trim-top" aria-hidden="true" />
                  <div className="cat-card-body">
                    <p className="cat-status" data-live={live}>
                      {live ? "MEASURED WEEKLY" : "NOT YET MEASURED"}
                    </p>
                    <h3>{category.label}</h3>
                    <p className="cat-question">{category.question}</p>
                    {stat ? (
                      <p className="cat-stat mono">
                        {stat.brands} brands tracked · {stat.weeks} week
                        {stat.weeks === 1 ? "" : "s"} recorded
                      </p>
                    ) : (
                      <p className="cat-stat mono cat-stat-dim">
                        No data published yet
                      </p>
                    )}
                  </div>
                </>
              );

              return live ? (
                <Link
                  key={category.slug}
                  href={`/chart/${category.slug}`}
                  className="cat-card"
                  data-live="true"
                >
                  {inner}
                </Link>
              ) : (
                <div key={category.slug} className="cat-card" data-live="false">
                  {inner}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
