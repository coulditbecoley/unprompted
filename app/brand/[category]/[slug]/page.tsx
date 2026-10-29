import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CATEGORIES, getCategory } from "@/lib/categories";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";
import {
  categoryLabel,
  allBrands,
  brandHistory,
  answeredPerQuestion,
  brandByEngine,
  brandCompanions,
  brandPositions,
  brandTone,
  latestRun,
  loadQuestionText,
  loadHistory,
  questionOrder,
  slugify,
  standings,
} from "@/lib/data";
import { ShareRow } from "@/components/freshness";
import { Kpi, LeaderBars, StatusBar, ToneBar, TrimTop, brandHref } from "@/components/ui";

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

  const description = row
      ? `${brand} was named in ${row.named} of ${row.totalRuns} AI answers about ${inSentence(categoryLabel(category))}, measured on ${run!.measured_on || run!.run_date}, and named first in ${Math.round(row.firstShare * 100)}% of them.`
      : `Tracking how often AI assistants name ${brand}.`;
  const url = `/brand/${category}/${slug}`;
  return {
    title: `${brand} in AI answers`,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${brand} in AI answers`, description, url, type: "article", siteName: "Unprompted" },
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
  const board = run ? standings(run) : [];
  const rank = board.findIndex((s) => s.brand === brand);
  const row = rank >= 0 ? board[rank] : null;
  const tone = run ? brandTone(run, brand) : null;
  const perEngine = run && row ? brandByEngine(run, brand) : [];
  const positions = run && row ? brandPositions(run, brand) : null;
  const companions = run && row ? brandCompanions(run, brand) : null;
  // Question by question, strongest first: which buying questions bring this
  // brand up, and which never do.
  const qText = run ? loadQuestionText(category, run) : {};
  const denominators = run ? answeredPerQuestion(run) : [];
  const perQuestion =
    run && row
      ? questionOrder(run)
          .map((id, i) => ({ id, text: qText[id] ?? id, named: row.stepNamed[i] ?? 0, of: denominators[i] ?? 0 }))
          .filter((q) => q.of > 0)
          .sort((a, b) => b.named / b.of - a.named / a.of || a.id.localeCompare(b.id))
      : [];
  const runs = loadHistory(category);
  const label = categoryLabel(category);
  const engineLabels = new Map(loadProviders().map((p) => [p.id, p.label]));
  // The brands either side of this one, so a reader sees it in context rather
  // than as a lone figure. The window shifts at the ends of the board.
  const from = Math.max(0, Math.min(rank - 2, board.length - 5));
  const neighbours = rank >= 0 ? board.slice(from, from + 5) : [];

  return (
    <section className="shell section">
      {/* The breadcrumb, machine-readable, so a search result shows board > brand. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: label, item: `https://unprompted.report/chart/${category}` },
              { "@type": "ListItem", position: 2, name: brand, item: `https://unprompted.report/brand/${category}/${slug}` },
            ],
          }).replace(/</g, "\\u003c"),
        }}
      />
      <nav className="crumbs label" aria-label="Breadcrumb">
        <Link href={`/chart/${category}`}>{label}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{brand}</span>
      </nav>
      <h1 className="display page-title rise">{brand}</h1>

      {/* Answer-first. The complete answer sits in the first sentence so it can
          be lifted whole. */}
      <p className="brand-lead rise" style={{ "--i": 1 } as React.CSSProperties}>
        {row ? (
          <>
            AI assistants named <strong>{brand}</strong> in {row.named} of{" "}
            {row.totalRuns} answers about {inSentence(label)}, measured on{" "}
            {run!.measured_on || run!.run_date}, and recommended it first in{" "}
            {Math.round(row.firstShare * 100)}% of them.
          </>
        ) : (
          <>{brand} was not named in any answer in the latest measurement.</>
        )}
      </p>
      {/* Trust is asked at the top, not after the history table. */}
      <p className="brand-trust rise" style={{ "--i": 2 } as React.CSSProperties}>
        Counted from {run ? run.engines.length : "several"} AI assistants&rsquo; answers to the same buying
        questions. Nobody can pay to appear. <Link href="/methodology">How this is measured →</Link>
      </p>

      {row && (
        <div className="kpi-row">
          <Kpi i={0} label="Board position" value={`#${rank + 1}`} unit={` of ${board.length}`} note="Ranked by how often it was the first pick." />
          <Kpi i={1} label="Named in" value={Math.round(row.rotation * 100)} unit="%" note={`${row.named} of ${row.totalRuns} answers mentioned it.`} meter={row.rotation} />
          <Kpi i={2} label="Named first" value={Math.round(row.firstShare * 100)} unit="%" note="Share of answers where it was the first recommendation." meter={row.firstShare} />
          <Kpi i={3} label="Typical position" value={row.medianPosition ?? "—"} note="Its usual place in the list when it was named (the median)." />
        </div>
      )}

      {run && (
        <StatusBar
          runDate={run.run_date}
          engines={run.engines.map((e) => engineLabels.get(e) ?? e)}
          methodVersion={run.method_version}
          runsPerQuestion={run.runs_per_question}
        />
      )}

      {row && (
        <div className="cmp-grid" style={{ marginTop: 14 }}>
          <div className="cmp-pick">
            <TrimTop />
            <h2 className="pick-h" style={{ marginTop: 6 }}>Every answer, one square each</h2>
            <div className="answer-grid" role="img" aria-label={`${row.named} of ${row.cells.length} answers named ${brand}.`}>
              {row.cells.map((on, i) => (
                <i key={i} className="seq-cell" data-on={on} />
              ))}
            </div>
            <p className="kpi-note" style={{ marginTop: 12 }}>
              Filled squares are answers that mentioned {brand}. Empty ones did not.
            </p>
          </div>

          <div className="cmp-pick">
            <TrimTop />
            {positions && (
              <>
                <h2 className="pick-h" style={{ marginTop: 6 }}>Where it appears in the answer</h2>
                <div className="pos-rows">
                  {(["First", "Second", "Third", "Fourth or later"] as const).map((label, i) => (
                    <div className="pos-row" key={label}>
                      <span>{label}</span>
                      <span className="meter" data-tone={i === 0 ? undefined : "soft"} aria-hidden="true">
                        <i style={{ "--v": positions[i] / Math.max(1, row.named) } as React.CSSProperties} />
                      </span>
                      <span className="mono">{positions[i]}</span>
                    </div>
                  ))}
                </div>
                <p className="kpi-note" style={{ marginTop: 10 }}>
                  Out of the {row.named} answers that named {brand}.
                </p>
              </>
            )}
            {tone ? (
              <>
                <h2 className="pick-h" style={{ marginTop: 22 }}>How it was described</h2>
                <ToneBar tone={tone} />
                <p className="tone-caveat">
                  Judged from the wording of each answer by our reading model, not stated by
                  the assistants. Treat it as softer evidence than the counts.
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}

      {row && (
        <ShareRow
          url={`https://unprompted.report/brand/${category}/${slug}`}
          headline={`AI assistants named ${brand} in ${Math.round(row.rotation * 100)}% of answers about ${inSentence(label)}, and first in ${Math.round(row.firstShare * 100)}%.`}
        />
      )}

      {neighbours.length > 1 && (
        <div className="reveal">
          <h2 className="sub-h">Where it sits on the board</h2>
          <p className="section-lead" style={{ marginBottom: 14 }}>
            Its closest neighbours in the latest reading. Pale bar: named at all. Solid bar: named first.
          </p>
          <LeaderBars rows={neighbours} start={from} highlight={brand} hrefFor={(b) => brandHref(category, b)} />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <span className="label" style={{ alignSelf: "center" }}>Compare with</span>
            {neighbours
              .filter((n) => n.brand !== brand)
              .map((n) => (
                <Link
                  key={n.brand}
                  className="btn btn-sm btn-ghost"
                  href={`/compare?${new URLSearchParams({ c: category, a: slug, b: slugify(n.brand) })}`}
                >
                  {n.brand}
                </Link>
              ))}
          </div>
        </div>
      )}

      {perEngine.length > 1 && (
        <div className="reveal">
          <h2 className="sub-h">Which assistants name it</h2>
          <p className="section-lead" style={{ marginBottom: 14 }}>
            The same questions, split by who answered. Pale bar: named at all. Solid bar: named first.
          </p>
          <div className="seq-board">
            <TrimTop />
            {perEngine.map((e) => (
              <div className="seq-row eng-row" key={e.engine}>
                <span className="eng-name">{engineLabels.get(e.engine) ?? e.engine}</span>
                <span className="eng-bars" aria-hidden="true">
                  <span className="meter" data-tone="soft"><i style={{ "--v": e.named / e.of } as React.CSSProperties} /></span>
                  <span className="meter"><i style={{ "--v": e.first / e.of } as React.CSSProperties} /></span>
                </span>
                <span className="mono eng-num">
                  {Math.round((e.named / e.of) * 100)}%
                  <small>{e.named}/{e.of} · {e.first} first</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {companions && companions.rows.length > 0 && (
        <div className="reveal">
          <h2 className="sub-h">Usually named alongside</h2>
          <p className="section-lead" style={{ marginBottom: 14 }}>
            When an answer named {brand}, these brands often came up in the same answer.
          </p>
          <div className="seq-board">
            <TrimTop />
            {companions.rows.map((c) => (
              <div className="seq-row bq-row" key={c.brand}>
                <Link className="bq-text" href={brandHref(category, c.brand)}>{c.brand}</Link>
                <span className="meter" data-tone="soft" aria-hidden="true"><i style={{ "--v": c.together / companions.of } as React.CSSProperties} /></span>
                <span className="mono bq-num">{Math.round((c.together / companions.of) * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="kpi-note" style={{ marginTop: 10 }}>
            Share of the {companions.of} answers that named {brand}.
          </p>
        </div>
      )}

      {perQuestion.length > 1 && (
        <div className="reveal">
          <h2 className="sub-h">Question by question</h2>
          <p className="section-lead" style={{ marginBottom: 14 }}>
            How many answers to each question named {brand}, strongest first. Open a question to read those answers.
          </p>
          <div className="seq-board">
            <TrimTop />
            {perQuestion.map((q) => (
              <div className="seq-row bq-row" key={q.id}>
                <Link className="bq-text" href={`/questions?${new URLSearchParams({ c: category, date: run!.run_date, brand, question: q.id })}#${q.id}`}>
                  {q.text}
                </Link>
                <span className="meter" aria-hidden="true"><i style={{ "--v": q.named / q.of } as React.CSSProperties} /></span>
                <span className="mono bq-num">{q.named}/{q.of}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {history.length > 1 && <Sparkline history={history} />}

      <h2 className="sub-h">Full history</h2>
      <div className="seq-board reveal">
        <TrimTop />
        <div className="seq-row seq-head hist-row">
          <span className="label">Measured</span>
          <span className="label">Named in</span>
          <span className="label" style={{ textAlign: "right" }}>First</span>
        </div>
        {history
          .slice()
          .reverse()
          .map((h) => (
            <div className="seq-row hist-row" key={h.date}>
              <span className="mono" style={{ fontSize: 13.5 }}><Link href={`/chart/${category}/${h.readingDate}`}>{h.date}</Link>{h.breakReason && <small className="hist-break">{h.breakReason}</small>}</span>
              <span className="hist-meter">
                <span className="meter" data-tone="soft" aria-hidden="true"><i style={{ "--v": h.rotation } as React.CSSProperties} /></span>
                <span className="mono">{Math.round(h.rotation * 100)}%</span>
              </span>
              <span className="mono" style={{ fontSize: 13, textAlign: "right" }}>
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

      <div className="btn-row" style={{ marginTop: 22 }}>
        <Link className="btn" href={`/chart/${category}`}>
          Back to the {inSentence(label)} board <span className="arr" aria-hidden="true">→</span>
        </Link>
        {run && row && (
          <Link className="btn btn-ghost" href={`/questions?${new URLSearchParams({ c: category, date: run.run_date, brand })}`}>
            Read the answers that named {brand}
          </Link>
        )}
      </div>

      <p className="mono" style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 20 }}>
        Tracked across {runs.length} measurement{runs.length === 1 ? "" : "s"}. Nobody can pay
        to appear. <Link href="/methodology">How we measure</Link> ·{" "}
        <a href="https://github.com/coulditbecoley/unprompted/tree/main/data/runs">the raw answers behind every figure</a>.
      </p>
    </section>
  );
}

/** Share of answers naming the brand over time. Hand-drawn SVG: no chart library for one line. */
function Sparkline({ history }: { history: ReturnType<typeof brandHistory> }) {
  const W = 720;
  const H = 140;
  // Room for the centred date labels at either end when points are labelled.
  const padX = history.length <= 8 ? 44 : 8;
  const padY = 14;
  const xy = history.map((h, i) => ({
    x: history.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (history.length - 1),
    y: H - padY - h.rotation * (H - padY * 2),
  }));
  const line = xy.map((p, i) => `${i === 0 || history[i].breakReason ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  // Area only under an unbroken line: shading across a break would draw a
  // continuity the method says is not there.
  const hasBreak = history.some((h, i) => i > 0 && h.breakReason);
  const area = hasBreak ? null : `M${xy[0].x},${H - padY} ${xy.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")} L${xy[xy.length - 1].x},${H - padY} Z`;
  const last = history[history.length - 1];
  const labelled = history.length <= 8;

  return (
    <div className="reveal">
      <h2 className="sub-h">Named in, week by week</h2>
      <p className="section-lead" style={{ marginBottom: 14 }}>
        Share of answers that mentioned it, one point per measurement, evenly spaced.
      </p>
      <div className="panel spark-panel" data-labelled={labelled}>
        <div className="spark-axis mono" aria-hidden="true">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg
          className="spark"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Share of answers naming it across ${history.length} measurements, currently ${Math.round(last.rotation * 100)} percent. Lines connect comparable measurements only.`}
        >
          <defs>
            <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="spark-grid" x1="0" y1={padY} x2={W} y2={padY} />
          <line className="spark-grid" x1="0" y1={H / 2} x2={W} y2={H / 2} strokeDasharray="3 4" />
          <line className="spark-grid" x1="0" y1={H - padY} x2={W} y2={H - padY} />
          {area && <path d={area} fill="url(#spark-fill)" />}
          <path className="spark-line" d={line} />
        </svg>
        <div className="spark-dots" aria-hidden="true">
          {xy.map((p, i) => (
            <i
              key={history[i].date}
              title={`${history[i].date}: ${Math.round(history[i].rotation * 100)}%`}
              style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
            />
          ))}
          {/* With only a handful of points, and with breaks that leave them
              unjoined, a bare dot says nothing. Print each value and its date. */}
          {labelled &&
            xy.map((p, i) => (
              <span
                key={history[i].date}
                className="spark-val mono"
                style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
              >
                {Math.round(history[i].rotation * 100)}%
              </span>
            ))}
          {labelled &&
            xy.map((p, i) => (
              <span key={history[i].date} className="spark-date mono" style={{ left: `${(p.x / W) * 100}%` }}>
                {history[i].date}
              </span>
            ))}
        </div>
        {!labelled && (
          <div className="spark-dates mono" aria-hidden="true">
            <span>{history[0].date}</span>
            <span>{last.date} · {Math.round(last.rotation * 100)}%</span>
          </div>
        )}
        {hasBreak && (
          <p className="kpi-note" style={{ marginTop: 10 }}>
            {history.slice(1).every((h) => h.breakReason)
              ? "The method changed between every one of these measurements, so the points are not joined: they cannot be compared as a trend."
              : "The line breaks where the method changed and weeks cannot be compared."}
          </p>
        )}
      </div>
    </div>
  );
}
