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
import { AwaitingFirstRun, ToneBar, TrimTop, brandHref } from "@/components/ui";

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
    description: `How often AI assistants name ${left} against ${right} when asked about ${categoryLabel(
      category,
    ).toLowerCase()}. Measured weekly, question by question.`,
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
      <section className="shell section">
        <CategoryTabs category={category} />
        <AwaitingFirstRun />
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

  const questions = loadQuestionText(category);
  const order = questionOrder(run);
  const weeks = Math.max(L.history.length, R.history.length);

  return (
    <section className="shell section">
      <CategoryTabs category={category} />

      <h1 className="display cmp-title">
        {L.brand} <span className="cmp-vs-title">vs</span> {R.brand}
      </h1>
      <p className="section-lead cmp-lead">
        <Verdict left={L.row} right={R.row} leftName={L.brand} rightName={R.brand} />{" "}
        {categoryLabel(category)}, week of {run.run_date}.
      </p>

      <Picker category={category} brands={brands} left={L.brand} right={R.brand} />

      <div className="cmp-grid cmp-cards">
        {sides.map(({ brand, row, history }, index) => (
          <div className="cmp-pick" key={brand}>
            <TrimTop />
            <h3>
              <Link href={brandHref(category, brand)}>{brand}</Link>
            </h3>
            {row ? (
              <>
                <p className="cmp-headline">
                  <span className="mono cmp-big">{Math.round(row.firstShare * 100)}%</span>
                  <span className="cmp-big-label">of runs named it first</span>
                </p>
                <i
                  className="seq-bar cmp-bar"
                  aria-hidden="true"
                  style={{ "--v": row.rotation } as React.CSSProperties}
                />
                <div className="cmp-stat">
                  <span>Named</span>
                  <span>
                    {row.named}/{row.totalRuns} · {Math.round(row.rotation * 100)}%
                  </span>
                </div>
                <div className="cmp-stat">
                  <span>Median position</span>
                  <span>{row.medianPosition ?? "—"}</span>
                </div>
                <div className="cmp-stat">
                  <span>Questions led</span>
                  <span>{questionsLed(row, sides[index === 0 ? 1 : 0].row)}</span>
                </div>
                <div className="cmp-stat">
                  <span>Weeks tracked</span>
                  <span>{history.length}</span>
                </div>
                {(() => {
                  const tone = brandTone(run, brand);
                  return tone ? (
                    <div className="cmp-tone">
                      <span className="label">Tone of mentions</span>
                      <ToneBar tone={tone} />
                    </div>
                  ) : null;
                })()}
              </>
            ) : (
              <p className="cmp-absent">
                Not named in any answer in the week of {run.run_date}.
              </p>
            )}
          </div>
        ))}
      </div>

      {L.row && R.row && (
        <>
          <h2 className="cmp-h2">Question by question</h2>
          <p className="cmp-note">
            How often each brand was named for each question asked. The larger
            figure in a pair is set in full weight; colour is not used, so the
            comparison reads the same in greyscale.
          </p>
          <div className="panel h2h">
            <div className="h2h-row h2h-head">
              <span className="label">Question</span>
              <span className="label h2h-name">{L.brand}</span>
              <span className="label h2h-name">{R.brand}</span>
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
          <h2 className="cmp-h2">Rotation over time</h2>
          <p className="cmp-note">
            The share of answers naming each brand, every measured week. A week
            with no mention is a zero, not a gap in the line.
          </p>
          <TwoLines a={L} b={R} weeks={weeks} />
        </>
      )}

      <h2 className="cmp-h2">Compare {L.brand} with</h2>
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
      <select id="cmp-a" name="a" defaultValue={slugify(left)} className="field">
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
      <select id="cmp-b" name="b" defaultValue={slugify(right)} className="field">
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
        {leftName} and {rightName} are each named first in {a}% of runs.
      </>
    );
  }
  const lead = a > b ? leftName : rightName;
  const trail = a > b ? rightName : leftName;
  return (
    <>
      {lead} is named first more often: {Math.max(a, b)}% of runs against{" "}
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
    <div className="h2h-row">
      <span className="h2h-q">{text}</span>
      <Side value={a} lead={a > b} label={aName} />
      <Side value={b} lead={b > a} label={bName} />
    </div>
  );
}

/** Intensity plus the figure. Weight marks the larger value, never colour. */
function Side({ value, lead, label }: { value: number; lead: boolean; label: string }) {
  const level =
    value >= 0.999 ? "4" : value >= 0.6 ? "3" : value >= 0.3 ? "2" : value > 0 ? "1" : "0";
  return (
    <span className="h2h-side">
      <i className="seq-cell h2h-cell" aria-hidden="true" data-level={level} />
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
  a: { brand: string; history: Array<{ date: string; rotation: number }> };
  b: { brand: string; history: Array<{ date: string; rotation: number }> };
  weeks: number;
}) {
  const W = 720;
  const H = 132;
  const pad = 10;

  const points = (history: Array<{ rotation: number }>) =>
    history
      .map((h, i) => {
        const x = pad + (i * (W - pad * 2)) / (weeks - 1);
        const y = H - pad - h.rotation * (H - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  const first = a.history[0]?.date ?? b.history[0]?.date;
  const last =
    a.history[a.history.length - 1]?.date ?? b.history[b.history.length - 1]?.date;

  return (
    <div className="panel cmp-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="cmp-svg"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Rotation across ${weeks} weeks: ${a.brand} against ${b.brand}.`}
      >
        {[0, 0.5, 1].map((t) => {
          const y = H - pad - t * (H - pad * 2);
          return <line key={t} className="spark-grid" x1={pad} x2={W - pad} y1={y} y2={y} />;
        })}
        <polyline className="cmp-line" points={points(a.history)} />
        <polyline className="cmp-line is-b" points={points(b.history)} />
      </svg>
      <div className="cmp-legend">
        <span className="mono">
          <i className="cmp-key" aria-hidden="true" /> {a.brand}
        </span>
        <span className="mono">
          <i className="cmp-key is-b" aria-hidden="true" /> {b.brand}
        </span>
        <span className="mono cmp-weeks">
          {first} to {last}
        </span>
      </div>
    </div>
  );
}
