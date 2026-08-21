import type { Metadata } from "next";
import Link from "next/link";

import {
  CATEGORY,
  CATEGORY_LABEL,
  allBrands,
  brandHistory,
  latestRun,
  slugify,
  standings,
} from "@/lib/data";
import { AwaitingFirstRun, TrimTop } from "@/components/ui";

export const metadata: Metadata = {
  title: "Head to head",
  description:
    "Compare two brands directly: how often each is named, and who gets named first.",
};

/**
 * Head-to-head. Static, and driven by a query string rather than client state,
 * so every comparison is a shareable URL — which is the point, since this is
 * the screen built for an argument in progress.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const run = latestRun(CATEGORY);
  const brands = allBrands(CATEGORY);

  if (!run || brands.length === 0) {
    return (
      <section className="shell">
        <AwaitingFirstRun />
      </section>
    );
  }

  const board = standings(run);
  const pick = (want: string | undefined, fallbackIndex: number) => {
    const found = want ? brands.find((x) => slugify(x) === slugify(want)) : null;
    return found ?? brands[Math.min(fallbackIndex, brands.length - 1)];
  };

  const left = pick(a, 0);
  const right = pick(b, 1);
  const rows = [left, right].map((brand) => ({
    brand,
    row: board.find((s) => s.brand === brand) ?? null,
    history: brandHistory(CATEGORY, brand),
  }));

  const [L, R] = rows;
  const verdict =
    L.row && R.row
      ? L.row.firstShare === R.row.firstShare
        ? `${L.brand} and ${R.brand} are named first equally often.`
        : `${L.row.firstShare > R.row.firstShare ? L.brand : R.brand} is named first more often.`
      : "Not enough data to compare these two yet.";

  return (
    <section className="shell section">
      <p className="label">{CATEGORY_LABEL} · head to head</p>
      <h1 style={{ fontSize: "clamp(28px,5vw,46px)", fontWeight: 800, margin: "6px 0 12px" }}>
        {L.brand} vs {R.brand}
      </h1>
      <p className="section-lead">{verdict} Week of {run.run_date}.</p>

      <div className="cmp-grid">
        {rows.map(({ brand, row, history }) => (
          <div className="cmp-pick" key={brand}>
            <TrimTop />
            <h3 style={{ marginTop: 6 }}>
              <Link href={`/brand/${slugify(brand)}`} style={{ textDecoration: "none" }}>
                {brand}
              </Link>
            </h3>
            {row ? (
              <>
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap", margin: "4px 0 14px" }}>
                  {row.cells.map((on, i) => (
                    <i key={i} className="seq-cell" data-on={on} style={{ animationDelay: `${i * 18}ms` }} />
                  ))}
                </div>
                <div className="cmp-stat">
                  <span>Named</span>
                  <span>
                    {row.named}/{row.totalRuns}
                  </span>
                </div>
                <div className="cmp-stat">
                  <span>Rotation</span>
                  <span>{Math.round(row.rotation * 100)}%</span>
                </div>
                <div className="cmp-stat">
                  <span>Named first</span>
                  <span>{Math.round(row.firstShare * 100)}%</span>
                </div>
                <div className="cmp-stat">
                  <span>Median position</span>
                  <span>{row.medianPosition ?? "—"}</span>
                </div>
                <div className="cmp-stat">
                  <span>Weeks tracked</span>
                  <span>{history.length}</span>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--fg-3)", fontSize: 14 }}>
                Not named in the most recent week.
              </p>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, marginTop: 40, marginBottom: 10 }}>Compare others</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {brands.map((brand) =>
          brand === L.brand ? null : (
            <Link
              key={brand}
              href={`/compare?a=${slugify(L.brand)}&b=${slugify(brand)}`}
              className="mono"
              style={{
                fontSize: 12,
                padding: "6px 11px",
                border: "1px solid var(--rule-2)",
                textDecoration: "none",
              }}
            >
              {L.brand} vs {brand}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
