import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CATEGORIES, getCategory } from "@/lib/categories";
import {
  categoryLabel,
  allBrands,
  brandHistory,
  latestRun,
  loadHistory,
  slugify,
  standings,
} from "@/lib/data";
import { StatusBar, TrimTop } from "@/components/ui";

/**
 * Statically generated, one permanent page per brand.
 *
 * Strategically this is the centrepiece: the page about PSA that AI assistants
 * themselves eventually cite when someone asks about PSA. It answers in the
 * first sentence, because citation research shows most citations come from the
 * top of a page.
 */
export function generateStaticParams() {
  return CATEGORIES.flatMap((c) =>
    allBrands(c.slug).map((brand) => ({ category: c.slug, slug: slugify(brand) })),
  );
}

function resolve(category: string, slug: string): string | null {
  return allBrands(category).find((b) => slugify(b) === slug) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}): Promise<Metadata> {
  const { category, slug } = await params;
  const brand = resolve(category, slug);
  if (!brand) return { title: "Unknown brand" };

  const run = latestRun(category);
  const row = run ? standings(run).find((s) => s.brand === brand) : null;

  return {
    title: `${brand} in AI answers`,
    description: row
      ? `${brand} was named in ${row.named} of ${row.totalRuns} AI answers about ${categoryLabel(category).toLowerCase()} in the week of ${run!.run_date}, and named first in ${Math.round(row.firstShare * 100)}% of them.`
      : `Tracking how often AI assistants name ${brand}.`,
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ category: string; slug: string }>;
}) {
  const { category, slug } = await params;
  if (!getCategory(category)) notFound();
  const brand = resolve(category, slug);
  if (!brand) notFound();

  const run = latestRun(category);
  const history = brandHistory(category, brand);
  const row = run ? standings(run).find((s) => s.brand === brand) : null;
  const runs = loadHistory(category);

  return (
    <section className="shell section">
      <p className="label">{categoryLabel(category)}</p>
      <h1 style={{ fontSize: "clamp(30px,5.5vw,52px)", fontWeight: 800, margin: "6px 0 14px" }}>
        {brand}
      </h1>

      {/* Answer-first. The complete answer sits in the first sentence so it can
          be lifted whole. */}
      <p style={{ fontSize: 19, color: "var(--fg-2)", maxWidth: "60ch", marginTop: 0 }}>
        {row ? (
          <>
            AI assistants named <strong>{brand}</strong> in {row.named} of{" "}
            {row.totalRuns} answers about {categoryLabel(category).toLowerCase()} in the week
            of {run!.run_date}, and named it first in{" "}
            {Math.round(row.firstShare * 100)}% of runs.
          </>
        ) : (
          <>
            {brand} was not named in any answer in the most recent measured week.
          </>
        )}
      </p>

      {run && (
        <div style={{ marginTop: 24 }}>
          <StatusBar
            runDate={run.run_date}
            engines={run.engines}
            methodVersion={run.method_version}
            runsPerQuestion={run.runs_per_question}
          />
        </div>
      )}

      {row && (
        <div className="cmp-grid" style={{ marginTop: 14 }}>
          <div className="cmp-pick">
            <TrimTop />
            <h3 style={{ marginTop: 6 }}>This week</h3>
            <div className="cmp-stat">
              <span>Rotation</span>
              <span>
                {row.named}/{row.totalRuns} · {Math.round(row.rotation * 100)}%
              </span>
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
          </div>

          <div className="cmp-pick">
            <TrimTop />
            <h3 style={{ marginTop: 6 }}>Every run this week</h3>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 10 }}>
              {row.cells.map((on, i) => (
                <i key={i} className="seq-cell" data-on={on} style={{ animationDelay: `${i * 18}ms` }} />
              ))}
            </div>
            <p style={{ fontSize: 13, color: "var(--fg-3)", marginTop: 12 }}>
              Filled means named in that run.
            </p>
          </div>
        </div>
      )}

      {history.length > 1 && <Sparkline history={history} />}

      <h2 style={{ fontSize: 22, marginTop: 44, marginBottom: 6 }}>Full history</h2>
      <div className="seq-board">
        <TrimTop />
        <div className="seq-row seq-head" style={{ gridTemplateColumns: "1fr auto auto" }}>
          <span className="label">Week</span>
          <span className="label">Named</span>
          <span className="label">First</span>
        </div>
        {history
          .slice()
          .reverse()
          .map((h) => (
            <div className="seq-row" key={h.date} style={{ gridTemplateColumns: "1fr auto auto" }}>
              <span className="mono" style={{ fontSize: 13.5 }}>{h.date}</span>
              <span className="mono" style={{ fontSize: 13 }}>{Math.round(h.rotation * 100)}%</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--fg-2)" }}>
                {Math.round(h.firstShare * 100)}%
              </span>
            </div>
          ))}
        {history.length === 0 && (
          <div className="seq-row">
            <span style={{ color: "var(--fg-3)" }}>Not yet measured.</span>
          </div>
        )}
      </div>

      <p className="mono" style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 20 }}>
        Measured across {runs.length} week{runs.length === 1 ? "" : "s"}. Raw answers
        for every figure are in the public repository.
      </p>
    </section>
  );
}

/** Rotation over time. Hand-drawn SVG: no chart library for one polyline. */
function Sparkline({ history }: { history: Array<{ date: string; rotation: number }> }) {
  const W = 720;
  const H = 72;
  const pad = 4;
  const points = history.map((h, i) => {
    const x = history.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (history.length - 1);
    const y = H - pad - h.rotation * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1].split(",");

  return (
    <>
      <h2 style={{ fontSize: 22, marginTop: 44, marginBottom: 6 }}>Rotation over time</h2>
      <div className="panel" style={{ padding: "18px 20px" }}>
        <svg
          className="spark"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Rotation across ${history.length} weeks, currently ${Math.round(history[history.length - 1].rotation * 100)} percent`}
        >
          <line className="spark-grid" x1="0" y1={H - pad} x2={W} y2={H - pad} />
          <line className="spark-grid" x1="0" y1={pad} x2={W} y2={pad} />
          <polyline className="spark-line" points={points.join(" ")} />
          <circle className="spark-dot" cx={last[0]} cy={last[1]} r="3.5" />
        </svg>
      </div>
    </>
  );
}
