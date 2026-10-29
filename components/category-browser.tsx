"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { SectionLink } from "@/components/contact";

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
  counts: Record<string, { leader: string | null; share: number; measured: string; agreement: { settled: number; total: number } | null } | undefined>;
}) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);

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
      <noscript><style>{".categories-page .cat-search { display: none; }"}</style></noscript>
      <div className="cat-search">
        <label htmlFor="cat-q" className="sr-only">
          Search categories or brands
        </label>
        <input
          id="cat-q"
          ref={searchInput}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search categories or brands"
          className="cat-search-input mono"
          autoComplete="off"
        />
        <span className="cat-search-count mono" aria-live="polite">
          {total} {total === 1 ? "category" : "categories"}
        </span>
      </div>

      {filtered.length === 0 && (
        <div className="panel cat-empty">
          <p style={{ margin: 0, color: "var(--fg-2)" }}>
            No categories match &ldquo;{query}&rdquo;. Try a broader term or clear
            the search to see all categories.
          </p>
          <button type="button" className="btn" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>Clear search</button>
        </div>
      )}

      {filtered.map(({ sector, categories }) => (
        <section key={sector.slug} className="cat-sector reveal">
          <div className="cat-sector-head">
            <p className="label">Category group</p>
            <h2 className="sub-h" id={`sector-${sector.slug}`}>{sector.label} <SectionLink id={`sector-${sector.slug}`} label={sector.label} /></h2>
            <p>{sector.blurb.replace(/\bengines\b/g, "assistants")}</p>
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
                      {live ? "Results available" : "No published results"}
                    </p>
                    <h3>{category.label}</h3>
                    <p className="cat-question">{category.question}</p>
                    {stat ? (
                      <div>
                      <p className="cat-stat mono">
                        {stat.leader ? <><strong>{stat.leader}</strong> · {Math.round(stat.share * 100)}% named first</> : "No brand named in this reading"}
                      </p>
                      <span className="meter cat-count-meter" aria-hidden="true"><i style={{ "--v": stat.share } as React.CSSProperties} /></span>
                      <p className="cat-agreement">{stat.agreement
                        ? `Assistants agree on the first pick for ${stat.agreement.settled} of ${stat.agreement.total} questions.`
                        : "Not enough assistants to compare agreement."}</p>
                      <p className="cat-scale">Measured {stat.measured}</p>
                      <span className="cat-open">Open board <span className="arr" aria-hidden="true">→</span></span>
                      </div>
                    ) : (
                      <p className="cat-stat mono cat-stat-dim">
                        No published results yet
                      </p>
                    )}
                  </div>
                </>
              );

              return live ? (
                <Link
                  key={category.slug}
                  href={`/chart/${category.slug}`}
                  className="cat-card card-lift"
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
