import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import Link from "next/link";

import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import {
  allBrands,
  answered,
  brandByEngine,
  leadIsClear,
  brandHistory,
  brandTone,
  categoryLabel,
  latestRun,
  loadQuestionText,
  questionOrder,
  slugify,
  standings,
  type BrandStanding,
} from "@/lib/data";
import { AwaitingFirstRun, Kpi, ToneBar, TrimTop, brandHref } from "@/components/ui";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";

type Params = { a?: string; b?: string; c?: string };

/**
 * Head to head.
 *
 * The screen built for an argument in progress, so every part of its state
 * lives in the query string: a comparison is a link somebody can paste back
 * into the thread they are arguing in, which is this publication's whole
 * distribution model.
 *
 * Controls are a plain GET form and links. No client state, nothing to hydrate,
 * and the back button does what a reader expects. The page works with
 * JavaScript switched off, because a screenshot argument should not depend on
 * it.
 */

function resolve(params: Params) {
  const category = params.c && getCategory(params.c) ? params.c : DEFAULT_CATEGORY;
  // Every brand ever charted here, so a comparison can include one that has
  // since dropped off the board.
  const brands = allBrands(category);

  // The default pair is the two brands at the top of the current board, not the
  // two that sort first alphabetically. Arriving at "Aider vs Amazon Q" asks the
  // reader to do the work of finding the argument; arriving at the two leaders
  // is the argument.
  const run = latestRun(category);
  const leaders = run ? standings(run).map((s) => s.brand) : [];
  const defaults = [...leaders, ...brands.filter((b) => !leaders.includes(b))];

  const pick = (want: string | undefined, fallback: number) =>
    (want ? brands.find((x) => slugify(x) === slugify(want)) : null) ??
    defaults[Math.min(fallback, Math.max(defaults.length - 1, 0))];

  return { category, brands, run, left: pick(params.a, 0), right: pick(params.b, 1) };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const { category, left, right, run } = resolve(await searchParams);
  const title = left && right ? `${left} vs ${right}: ${categoryLabel(category)}` : `Compare brands: ${categoryLabel(category)}`;
  const board = run ? standings(run) : [];
  const first = (brand: string) => Math.round((board.find(row => row.brand === brand)?.firstShare ?? 0) * 100);
  const description = run && left && right && board.length
    ? `${left} is named first in ${first(left)}% of answers; ${right} in ${first(right)}%. ${categoryLabel(category)}, measured ${run.measured_on || run.run_date}. Errors and refusals excluded.`
    : `Compare recorded brand mentions for ${inSentence(categoryLabel(category))}. No published comparison is available yet.`;
  const url = `/compare?${new URLSearchParams({ c: category, ...(left ? { a: slugify(left) } : {}), ...(right ? { b: slugify(right) } : {}) })}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", siteName: "Unprompted" } };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { category, brands, run, left, right } = resolve(await searchParams);

  if (!run || brands.length === 0) {
    return (
      <section className="shell section cmp-page">
        <CategoryTabs category={category} />
        <h1 className="display page-title rise">Compare two brands.</h1>
        <AwaitingFirstRun />
        <Link className="btn" href="/categories">Browse available results</Link>
      </section>
    );
  }

  const board = standings(run);
  const presets = CATEGORIES.flatMap(c => {
    const reading = c.slug === category ? run : latestRun(c.slug);
    const leaders = reading ? standings(reading) : [];
    return leaders.length < 2 ? [] : [{ label: `${c.label}: top two`, category: c.slug, a: leaders[0].brand, b: leaders[1].brand }];
  });
  const gap = [...board].sort((a, b) => (b.named - b.firstNamed) - (a.named - a.firstNamed))[0];
  const rival = board.find(row => row.brand !== gap?.brand);
  if (gap && rival && gap.named > gap.firstNamed) presets.push({
    label: `Largest mention/first-pick gap: ${gap.brand} vs ${rival.brand}`,
    category, a: gap.brand, b: rival.brand,
  });
  const rowFor = (brand: string) => board.find((s) => s.brand === brand) ?? null;
  const sides = [left, right].map((brand) => ({
    brand,
    row: rowFor(brand),
    history: brandHistory(category, brand),
    assistants: brandByEngine(run, brand),
  }));
  const [L, R] = sides;
  const total = answered(run).length;
  const labels = new Map(loadProviders().map(p => [p.id, p.label]));

  const questions = loadQuestionText(category, run);
  const order = questionOrder(run);
  const weeks = Math.max(L.history.length, R.history.length);

  return (
    <section className="shell section cmp-page">
      <CategoryTabs category={category} />

      <h1 className="display page-title rise cmp-title">
        {L.brand} <span className="cmp-vs-title">vs</span> {R.brand}
      </h1>
      <p className="section-lead cmp-lead">
        Compare how often AI assistants mention these two brands, so you can see
        which gets more visibility in their answers.
      </p>
      <p className="cmp-note cmp-verdict">
        <Verdict left={L.row} right={R.row} leftName={L.brand} rightName={R.brand} total={total} />{" "}
        {categoryLabel(category)}, measured on {run.measured_on || run.run_date}.
      </p>

      <Picker category={category} brands={brands} left={L.brand} right={R.brand} />
      <nav className="cmp-presets" aria-label="Suggested comparisons">
        <p className="cmp-note">Try a comparison. Each link keeps the selected pair in the URL.</p>
        <div>{presets.map(p => <a className="btn btn-sm" key={p.label} href={`/compare?${new URLSearchParams({ c: p.category, a: slugify(p.a), b: slugify(p.b) })}`}>{p.label}</a>)}</div>
        <p className="cmp-note">The gap is the number of answers naming a brand anywhere minus those naming it first, on this board.</p>
      </nav>
      <div className="kpi-row">
        <Kpi label="Answers" value={total} note="The same answers are used for both brands." />
        <Kpi i={1} label="Questions answered" value={order.length} note="Compare mentions for each question below." />
        <Kpi i={2} label="Measurements" value={weeks} note="History retains breaks where methods differ." />
      </div>
      <p className="cmp-note">
        Named means mentioned anywhere in an answer; named first means the first
        brand mentioned. Percentages exclude failed calls and refusals. They
        measure visibility, not product quality. Typical place in the list is the middle
        position among answers that mention the brand. The first-pick lead check
        is a minimum sampling check, not proof of a lasting preference.
      </p>

      <nav className="evidence-links" aria-label="Check this comparison">
        <Link href={`/questions?${new URLSearchParams({ c: category, date: run.run_date })}`}>Read the recorded answers</Link>
        <Link href="/methodology#glossary">How the answers are counted</Link>
      </nav>
      <p className="label codex-section-label">Overview</p>
      <h2 className="sub-h">The two brands</h2>
      <p className="cmp-note">First picks and mentions in this reading.</p>
      <div className="cmp-grid cmp-cards">
        {sides.map(({ brand, row, history }, index) => (
          <div className="cmp-pick reveal" key={`${brand}-${index}`}>
            <TrimTop />
            <h3 className="cmp-brand-title">
              <Link href={brandHref(category, brand)}>{brand}</Link>
            </h3>
            {row ? (
              <>
                <p className="cmp-headline">
                  <span className="mono cmp-big">{Math.round(row.firstShare * 100)}%</span>
                  <span className="cmp-big-label">of answers named it first</span>
                </p>
                <span className="meter cmp-bar" aria-hidden="true"><i style={{ "--v": row.firstShare } as React.CSSProperties} /></span>
                <div className="cmp-stat">
                  <span>Mentioned anywhere</span>
                  <span>
                    {row.named}/{row.totalRuns} · {Math.round(row.rotation * 100)}%
                  </span>
                </div>
                <div className="cmp-stat">
                  <span>Typical place in the list</span>
                  <span>{row.medianPosition ?? "—"}</span>
                </div>
                <div className="cmp-stat">
                  <span>Questions mentioned more often</span>
                  <span>{questionsLed(row, sides[index === 0 ? 1 : 0].row)}</span>
                </div>
                <div className="cmp-stat">
                  <span>Measurements tracked</span>
                  <span>{history.length}</span>
                </div>
                {(() => {
                  const tone = brandTone(run, brand);
                  return tone ? (
                    <div className="cmp-tone">
                      <span className="label">Tone of mentions</span>
                      <ToneBar tone={tone} />
                      <p className="cmp-note">Tone is the extraction model&rsquo;s interpretation of the wording.</p>
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              <p className="cmp-absent">
                Not named in any answer measured on {run.measured_on || run.run_date}.
              </p>
            )}
          </div>
        ))}
      </div>

      <p className="label codex-section-label">Assistants</p>
      <h2 className="sub-h" id="assistants">Assistant by assistant <SectionLink id="assistants" label="Assistant by assistant" /></h2>
      <p className="cmp-note" id="assistant-counting">
        Each assistant’s count and share of answers mentioning either brand.
      </p>
      <p className="cmp-note">
        Both brands use the same answers; errors and refusals are excluded. An assistant with no answers after those exclusions is omitted.
      </p>
      {L.assistants.length === 0 ? <p className="cmp-note">No answers are available for an assistant comparison in this reading.</p> : (
        <div className="panel cmp-assistants">
          <table aria-describedby="assistant-counting">
            <caption className="sr-only">Brand mentions by assistant</caption>
            <thead><tr><th scope="col">Assistant</th><th scope="col">{L.brand}</th><th scope="col">{R.brand}</th></tr></thead>
            <tbody>{L.assistants.map(l => {
              const r = R.assistants.find(row => row.engine === l.engine)!;
              return <tr key={l.engine} data-engine={l.engine}>
                <th scope="row">{labels.get(l.engine) ?? l.engine}</th>
                {[l, r].map((entry, i) => <td key={i}>
                  <span className="mono cmp-assistant-count">{entry.named}/{entry.of} <span className="sr-only">answers named {sides[i].brand}; </span></span>
                  <span className="mono cmp-assistant-share">{Math.round(entry.named / entry.of * 100)}%</span>
                  <span className="meter" aria-hidden="true"><i style={{ "--v": entry.named / entry.of } as React.CSSProperties} /></span>
                </td>)}
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {L.row && R.row && (
        <>
          <p className="label codex-section-label">Questions</p>
      <h2 className="sub-h" id="questions">Question by question <SectionLink id="questions" label="Question by question" /></h2>
          {!run.methodology?.questions && <p className="cmp-note">Legacy reading: question wording comes from the current bank; historical wording was not recorded.</p>}
          <p className="cmp-note">
            The share of answers mentioning each brand, question by question.
          </p>
          <p className="cmp-note">
            Bold marks the larger share, not a proven
            difference in quality.
          </p>
          <div className="panel h2h reveal" role="table" aria-label="Brand mentions by question">
            <div className="h2h-row h2h-head" role="row">
              <span className="label" role="columnheader">Question</span>
              <span className="label h2h-name" role="columnheader">{L.brand}</span>
              <span className="label h2h-name" role="columnheader">{R.brand}</span>
            </div>
            {order.map((qid, i) => (
              <QuestionRow
                key={qid}
                text={questions[qid] ?? qid}
                a={L.row!.steps[i] ?? 0}
                b={R.row!.steps[i] ?? 0}
                aName={L.brand}
                bName={R.brand}
              />
            ))}
          </div>
        </>
      )}

      {weeks > 1 && (
        <>
          <p className="label codex-section-label">History</p>
      <h2 className="sub-h" id="history">Mentions over time <SectionLink id="history" label="Mentions over time" /></h2>
          <p className="cmp-note">
            Each point shows the share of answers that mention a brand.
          </p>
          <p className="cmp-note">
            Zero means none mentioned it. Points are evenly spaced by measurement,
            not by elapsed time.
          </p>
          <TwoLines a={L} b={R} weeks={weeks} />
        </>
      )}

      <p className="label codex-section-label">Explore</p>
      <h2 className="sub-h" id="other-brands">Compare {L.brand} with <SectionLink id="other-brands" label="Other comparisons" /></h2>
      <p className="cmp-note">Choose another brand to keep exploring this category.</p>
      <div className="q-chips">
        {brands
          .filter((brand) => brand !== L.brand)
          .map((brand) => (
            <Link
              key={brand}
              href={`/compare?c=${category}&a=${slugify(L.brand)}&b=${slugify(brand)}`}
              className="q-chip cmp-chip"
              aria-current={brand === R.brand ? "page" : undefined}
            >
              {brand}
            </Link>
          ))}
      </div>
    </section>
  );
}

/* -- pieces ---------------------------------------------------------------- */

function CategoryTabs({ category }: { category: string }) {
  return (
    <nav className="cat-tabs" aria-label="Category">
      {CATEGORIES.map((c) => (
        <Link
          key={c.slug}
          href={`/compare?c=${c.slug}`}
          className="cat-tab"
          aria-current={c.slug === category ? "page" : undefined}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Both sides are choosable, which the previous version got wrong: only the
 * right-hand brand could be changed, so comparing two challengers meant editing
 * the URL by hand.
 */
function Picker({
  category,
  brands,
  left,
  right,
}: {
  category: string;
  brands: string[];
  left: string;
  right: string;
}) {
  return (
    <form className="cmp-form" action="/compare" method="get">
      <input type="hidden" name="c" value={category} />
      <label className="sr-only" htmlFor="cmp-a">
        First brand
      </label>
      <select id="cmp-a" name="a" defaultValue={slugify(left)} className="select">
        {brands.map((b) => (
          <option key={b} value={slugify(b)}>
            {b}
          </option>
        ))}
      </select>
      <span className="cmp-vs" aria-hidden="true">
        vs
      </span>
      <label className="sr-only" htmlFor="cmp-b">
        Second brand
      </label>
      <select id="cmp-b" name="b" defaultValue={slugify(right)} className="select">
        {brands.map((b) => (
          <option key={b} value={slugify(b)}>
            {b}
          </option>
        ))}
      </select>
      <button className="btn btn-go" type="submit">
        Compare
      </button>
    </form>
  );
}

/** First picks share a denominator; test their lead before describing one. */
function Verdict({ left, right, leftName, rightName, total }: {
  left: BrandStanding | null;
  right: BrandStanding | null;
  leftName: string;
  rightName: string;
  total: number;
}) {
  if (leftName === rightName) return <>Both selections show {leftName}. Choose two different brands to compare.</>;
  if (!total) return <>No answers are available to compare these brands in this reading.</>;
  const a = left?.firstNamed ?? 0;
  const b = right?.firstNamed ?? 0;
  const aShare = Math.round(a / total * 100);
  const bShare = Math.round(b / total * 100);
  if (a === b) return <>{leftName} and {rightName} were each named first in {a} of {total} answers ({aShare}%). Neither has a first-pick lead.</>;
  if (!leadIsClear(Math.max(a, b), Math.min(a, b), total)) {
    return <>{leftName} was named first in {aShare}% of answers; {rightName} in {bShare}%. This sample does not establish a clear first-pick lead.</>;
  }
  return <>{a > b ? leftName : rightName} has a clear first-pick lead in this sample: {Math.max(aShare, bShare)}% versus {Math.min(aShare, bShare)}% for {a > b ? rightName : leftName}.</>;
}

function QuestionRow({
  text,
  a,
  b,
  aName,
  bName,
}: {
  text: string;
  a: number;
  b: number;
  aName: string;
  bName: string;
}) {
  return (
    <div className="h2h-row" role="row">
      <span className="h2h-q" role="rowheader">{text}</span>
      <Side value={a} lead={a > b} label={aName} />
      <Side value={b} lead={b > a} label={bName} />
    </div>
  );
}

/** Intensity plus the figure. Weight marks the larger value, never colour. */
function Side({ value, lead, label }: { value: number; lead: boolean; label: string }) {
  return (
    <span className="h2h-side" role="cell">
      <span className="meter cmp-question-meter" aria-hidden="true"><i style={{ "--v": value } as React.CSSProperties} /></span>
      <span className="mono h2h-pct" data-lead={lead}>
        <span className="sr-only">{label}: </span>
        {Math.round(value * 100)}%
      </span>
    </span>
  );
}

/** How many questions this brand was named for more often than the other. */
function questionsLed(row: BrandStanding, other: BrandStanding | null): string {
  if (!other) return "—";
  const led = row.steps.filter((v, i) => v > (other.steps[i] ?? 0)).length;
  return `${led}/${row.steps.length}`;
}

/**
 * Both histories on one set of axes.
 *
 * Hand-drawn SVG rather than a chart library: two polylines over a shared scale
 * is less code than the configuration a library would need, and it inherits the
 * theme tokens for free. The series are told apart by a solid and a dashed
 * stroke as well as by colour, so the comparison survives greyscale.
 */
function TwoLines({
  a,
  b,
  weeks,
}: {
  a: { brand: string; history: ReturnType<typeof brandHistory> };
  b: { brand: string; history: ReturnType<typeof brandHistory> };
  weeks: number;
}) {
  const W = 720;
  const H = 180;
  const pad = 48;
  const dates = [...new Set([...a.history, ...b.history].map(h => h.date))].sort();
  const x = (date: string) => pad + (dates.indexOf(date) * (W - pad * 2)) / Math.max(dates.length - 1, 1);
  const y = (share: number) => H - 18 - share * (H - 56);
  const hasBreak = [a, b].some(side => side.history.some((h, i) => i > 0 && h.breakReason));
  const labelled = dates.length <= 8;
  const allBreaks = hasBreak && [a, b].every(side => side.history.slice(1).every(h => h.breakReason));
  const allMethodChanges = allBreaks && [a, b].every(side => side.history.slice(1).every(h => h.breakReason?.includes("changed")));
  return (
    <div className="panel cmp-chart reveal">
      <div className="cmp-chart-scroll" role="region" aria-label="Mention history" tabIndex={0}>
      <div style={labelled ? { minWidth: dates.length * 100 } : undefined}>
      <div className="cmp-plot">
        <div className="cmp-axis mono" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="cmp-history-svg" preserveAspectRatio="none" role="img"
          aria-label={`Share of answers mentioning ${a.brand} and ${b.brand} across ${weeks} measurements. Lines stop at method changes.`}>
          {[0, 0.5, 1].map(t => <line key={t} className="spark-grid" x1={pad} x2={W-pad} y1={y(t)} y2={y(t)} />)}
          {[a, b].map((side, index) => <g key={index}>
            <path className={`cmp-history-line${index ? " is-b" : ""}`} d={side.history.map((h, i) =>
              `${i === 0 || h.breakReason ? "M" : "L"}${x(h.date)},${y(h.rotation)}`).join(" ")} />
          </g>)}
        </svg>
        <div className="cmp-history-dots">
          {[a, b].map((side, index) => side.history.map(h => <span key={`${index}-${h.date}`}
            className={`cmp-history-dot${index ? " is-b" : ""}`} tabIndex={0} role="img"
            data-right={x(h.date) > W / 2}
            aria-label={`${side.brand}, ${h.date}: ${Math.round(h.rotation * 100)} percent`}
            title={`${side.brand}, ${h.date}: ${Math.round(h.rotation * 100)}%${h.breakReason ? `: ${h.breakReason}` : ""}`}
            style={{ left: `${x(h.date)/W*100}%`, top: `${y(h.rotation)/H*100}%` }} />))}
          {labelled && [a, b].map((side, index) => side.history.map(h => {
            const other = (index ? a : b).history.find(point => point.date === h.date);
            const close = other && Math.abs(y(other.rotation) - y(h.rotation)) < 34;
            const upper = other && (h.rotation > other.rotation || (h.rotation === other.rotation && index === 0));
            return <span key={`value-${index}-${h.date}`} className={`cmp-history-value mono${index ? " is-b" : ""}`}
              style={{ left: `${x(h.date)/W*100}%`, top: `${y(close ? Math.max(h.rotation, other.rotation) : h.rotation)/H*100}%`, marginTop: close && upper ? -32 : -12 }}>
              <span aria-hidden="true">{index ? "\u25a1" : "\u25cf"} </span><span className="sr-only">{side.brand}: </span>{Math.round(h.rotation * 100)}%
            </span>;
          }))}
        </div>
      </div>
      {labelled ? <div className="cmp-history-dates cmp-labelled-dates mono">{dates.map(date => <span key={date} style={{ left: `${x(date)/W*100}%` }}>{date}</span>)}</div>
        : <div className="cmp-history-dates mono"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>}
      </div></div>
      <div className="cmp-legend"><span><i className="cmp-key" aria-hidden="true" /> {a.brand} (solid dot)</span><span><i className="cmp-key is-b" aria-hidden="true" /> {b.brand} (open square)</span></div>
      {hasBreak && <p className="kpi-note">{allMethodChanges ? "The method changed between every measurement shown, so these separate points cannot be read as a trend." : allBreaks ? "None of these measurements can be compared as a trend; focus a point to read why." : "Gaps in the lines mark measurements that cannot be compared; focus a point to read why."}</p>}
    </div>
  );
}
