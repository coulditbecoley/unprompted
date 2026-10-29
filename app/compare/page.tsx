import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import Link from "next/link";

import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import {
  allBrands,
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
  const { category, left, right } = resolve(await searchParams);
  if (!left || !right) return { title: "Head to head" };

  // Spelled out because the link is the artefact that travels: a pasted
  // comparison should say what it is before anyone clicks it.
  return {
    title: `${left} vs ${right}`,
    openGraph: { title: `${left} vs ${right}`, description: `Compare brand mentions in AI answers about ${inSentence(categoryLabel(category))}.` },
    description: `How often AI assistants name ${left} against ${right} when asked about ${inSentence(categoryLabel(category))}. Measured question by question.`,
  };
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
  const rowFor = (brand: string) => board.find((s) => s.brand === brand) ?? null;
  const sides = [left, right].map((brand) => ({
    brand,
    row: rowFor(brand),
    history: brandHistory(category, brand),
  }));
  const [L, R] = sides;

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
      <p className="cmp-note">
        <Verdict left={L.row} right={R.row} leftName={L.brand} rightName={R.brand} />{" "}
        {categoryLabel(category)}, measured on {run.measured_on || run.run_date}.
      </p>

      <Picker category={category} brands={brands} left={L.brand} right={R.brand} />
      <div className="kpi-row">
        <Kpi label="Usable answers" value={board[0]?.totalRuns ?? 0} note="The same answers are used for both brands." />
        <Kpi i={1} label="Questions answered" value={order.length} note="Compare mentions for each question below." />
        <Kpi i={2} label="Measurements" value={weeks} note="History retains breaks where methods differ." />
      </div>
      <p className="cmp-note">
        Named means mentioned anywhere in an answer; named first means the first
        brand mentioned. Percentages exclude failed calls and refusals. They
        measure visibility, not product quality. Median position is the middle
        position among answers that mention the brand.
      </p>

      <div className="cmp-grid cmp-cards">
        {sides.map(({ brand, row, history }, index) => (
          <div className="cmp-pick reveal" key={`${brand}-${index}`}>
            <TrimTop />
            <h2 className="cmp-brand-title">
              <Link href={brandHref(category, brand)}>{brand}</Link>
            </h2>
            {row ? (
              <>
                <p className="cmp-headline">
                  <span className="mono cmp-big">{Math.round(row.firstShare * 100)}%</span>
                  <span className="cmp-big-label">of usable answers named it first</span>
                </p>
                <span className="meter cmp-bar" aria-hidden="true"><i style={{ "--v": row.firstShare } as React.CSSProperties} /></span>
                <div className="cmp-stat">
                  <span>Mentioned anywhere</span>
                  <span>
                    {row.named}/{row.totalRuns} · {Math.round(row.rotation * 100)}%
                  </span>
                </div>
                <div className="cmp-stat">
                  <span>Median position</span>
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

      {L.row && R.row && (
        <>
          <h2 className="sub-h" id="questions">Question by question <SectionLink id="questions" label="Question by question" /></h2>
          {!run.methodology?.questions && <p className="cmp-note">Legacy reading: question wording comes from the current bank; historical wording was not recorded.</p>}
          <p className="cmp-note">
            Each percentage is the share of usable answers to that question
            that mention the brand. Bold marks the larger share, not a proven
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
          <h2 className="sub-h" id="history">Mentions over time <SectionLink id="history" label="Mentions over time" /></h2>
          <p className="cmp-note">
            Rotation is the share of usable answers that mention a brand. Zero
            means none mentioned it. Points are evenly spaced by measurement,
            not by elapsed time.
          </p>
          <TwoLines a={L} b={R} weeks={weeks} />
        </>
      )}

      <h2 className="sub-h" id="other-brands">Compare {L.brand} with <SectionLink id="other-brands" label="Other comparisons" /></h2>
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

/**
 * States both figures and which is larger.
 *
 * It never declares a winner or says one brand is better: this publication
 * reports what machines said and does not rank.
 */
function Verdict({
  left,
  right,
  leftName,
  rightName,
}: {
  left: BrandStanding | null;
  right: BrandStanding | null;
  leftName: string;
  rightName: string;
}) {
  if (!left || !right) return <>Not enough data to compare these two yet.</>;
  const a = Math.round(left.firstShare * 100);
  const b = Math.round(right.firstShare * 100);
  if (a === b) {
    return (
      <>
        {leftName} and {rightName} are each named first in {a}% of usable answers, rounded to whole percentages.
      </>
    );
  }
  const lead = a > b ? leftName : rightName;
  const trail = a > b ? rightName : leftName;
  return (
    <>
      {lead} is named first more often: {Math.max(a, b)}% of usable answers against{" "}
      {Math.min(a, b)}% for {trail}.
    </>
  );
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
  const pad = 14;
  const dates = [...new Set([...a.history, ...b.history].map(h => h.date))].sort();
  const x = (date: string) => pad + (dates.indexOf(date) * (W - pad * 2)) / Math.max(dates.length - 1, 1);
  const y = (share: number) => H - pad - share * (H - pad * 2);
  const hasBreak = [a, b].some(side => side.history.some((h, i) => i > 0 && h.breakReason));
  return (
    <div className="panel cmp-chart reveal">
      <div className="cmp-plot">
        <div className="cmp-axis mono" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="cmp-history-svg" preserveAspectRatio="none" role="img"
          aria-label={`Share of usable answers mentioning ${a.brand} and ${b.brand} across ${weeks} measurements. Lines stop at method changes.`}>
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
            title={`${side.brand}, ${h.date}: ${Math.round(h.rotation * 100)}%${h.breakReason ? ` ? ${h.breakReason}` : ""}`}
            style={{ left: `${x(h.date)/W*100}%`, top: `${y(h.rotation)/H*100}%` }} />))}
        </div>
      </div>
      <div className="cmp-history-dates mono"><span>{dates[0]}</span><span>{dates.at(-1)}</span></div>
      <div className="cmp-legend"><span><i className="cmp-key" aria-hidden="true" /> {a.brand} (solid)</span><span><i className="cmp-key is-b" aria-hidden="true" /> {b.brand} (dashed)</span></div>
      {hasBreak && <p className="kpi-note">Some measurements cannot be compared, so they appear as separate dots. No line is drawn across a method change.</p>}
    </div>
  );
}
