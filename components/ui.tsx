/**
 * The primitives every layer reuses.
 *
 * Carbon appears here and nowhere else, so the trim budget for the whole site
 * is auditable from one file.
 */

import Link from "next/link";

import { Logo } from "@/components/logo";
import { NavLinks } from "@/components/nav-links";
import type { BrandStanding, Movement } from "@/lib/data";
import { boardTakeaways } from "@/lib/metrics";
// From lib/shared, not lib/data: this file is imported by a client component,
// and lib/data reads the repository with node:fs.
import { OPERATOR, OPERATOR_URL, slugify } from "@/lib/shared";

/* -- hairline trim -------------------------------------------------------- */

export function TrimTop() {
  return <span className="trim-top" aria-hidden="true" />;
}

/* -- the sequencer row: one cell per run ---------------------------------- */

export function SequencerRow({
  standing,
  rank,
  move,
  href,
  activeStep = null,
  onStep,
  transitionName,
}: {
  standing: BrandStanding;
  rank: number;
  move?: Movement;
  href?: string;
  /** Which question column is being read, if any. See LiveBoard. */
  activeStep?: number | null;
  onStep?: (step: number | null) => void;
  /** Lets a re-sort animate each row to its new place. See LiveBoard. */
  transitionName?: string;
}) {
  const name = href ? (
    <Link href={href} style={{ textDecoration: "none" }}>
      {standing.brand}
    </Link>
  ) : (
    standing.brand
  );

  return (
    <div
      className="seq-row"
      role="row"
      style={transitionName ? ({ viewTransitionName: transitionName, viewTransitionClass: "board-row" } as React.CSSProperties) : undefined}
    >
      <span className="mono seq-rank" role="cell" data-lead={rank === 1}>
        {String(rank).padStart(2, "0")}
      </span>
      {/* The rotation bar makes the ordering readable without reading a number.
          Deliberately neutral: colour on this board means movement. */}
      <span className="seq-brand" role="rowheader">
        {name}
        <i
          className="seq-bar"
          aria-hidden="true"
          style={{ "--v": standing.rotation } as React.CSSProperties}
        />
      </span>

      {/*
        One step per question, not one cell per run. At 225 runs a per-run row
        overflowed the page and pushed every number off screen. Intensity is the
        step sequencer's own idea, and it carries more: you can see which
        questions a brand actually wins.
      */}
      {/*
        One listener on the container rather than fifteen on the cells: the
        index is read back off the target, which is the same information for a
        fifteenth of the handlers.
      */}
      <span
        className="seq-cells"
        role="cell"
        aria-label={`Named in ${standing.named} of ${standing.totalRuns} answers, across ${standing.steps.length} questions`}
        data-focus={activeStep !== null}
        onMouseMove={
          onStep &&
          ((e: React.MouseEvent<HTMLSpanElement>) => {
            const i = (e.target as HTMLElement).dataset?.step;
            if (i !== undefined) onStep(Number(i));
          })
        }
      >
        {standing.steps.map((v, i) => (
          <i
            key={i}
            className="seq-cell"
            data-step={i}
            data-active={i === activeStep}
            data-level={
              v >= 0.999 ? "4" : v >= 0.6 ? "3" : v >= 0.3 ? "2" : v > 0 ? "1" : "0"
            }
          />
        ))}
      </span>

      <span className="mono seq-rot" role="cell">
        {standing.named}/{standing.totalRuns}
      </span>
      <span className="mono seq-first" role="cell" data-lead={rank === 1}>
        {Math.round(standing.firstShare * 100)}%
      </span>
      <Delta move={move} />
    </div>
  );
}

/**
 * Movement is carried by the arrow glyph and the sign, not by colour. Colour is
 * reinforcement only, so the board still reads correctly in greyscale and for
 * anyone who cannot distinguish the two hues.
 */
export function Delta({ move }: { move?: Movement }) {
  if (!move) return <span role="cell" className="mono seq-delta" />;
  if (move.isNew) return <span role="cell" className="mono seq-delta is-new">NEW</span>;
  if (move.rotationDelta === 0) return <span role="cell" className="mono seq-delta">—</span>;

  const up = move.rotationDelta > 0;

  // A change this sample cannot support gets its number and neither the arrow
  // nor the colour. Both of those are the site saying "this happened", and on a
  // fifteen-question week a few points often did not: the figure is still shown
  // because hiding it would be its own kind of dishonesty.
  if (!move.significant) {
    return (
      <span
        role="cell" className="mono seq-delta is-noise"
        title="Within the noise of this sample. Reported, not called a move."
      >
        {up ? "+" : "−"}
        {Math.abs(move.rotationDelta)}
      </span>
    );
  }

  return (
    <span role="cell" className={`mono seq-delta ${up ? "is-up" : "is-down"}`}>
      {up ? "▲" : "▼"}
      {Math.abs(move.rotationDelta)}
    </span>
  );
}

/* -- status bar ----------------------------------------------------------- */

export function StatusBar({
  runDate,
  engines,
  methodVersion,
  runsPerQuestion,
}: {
  runDate: string;
  engines: string[];
  methodVersion: number;
  runsPerQuestion: number;
}) {
  return (
    <div className="statusbar">
      {/* Plain words: "5 RUNS/Q" read as code to anyone outside the project. */}
      <span className="mono">Published {runDate}</span>
      <span className="mono">Method v{methodVersion}</span>
      <span className="mono">Each question asked {runsPerQuestion}× per assistant</span>
      <span className="mono">
        {engines.length} assistant{engines.length === 1 ? "" : "s"}: {engines.join(" · ")}
      </span>
    </div>
  );
}

/* -- site chrome ---------------------------------------------------------- */

export function SiteHeader() {
  return (
    <header className="site-head">
      <div className="shell site-head-inner">
        <Link href="/" className="wordmark" aria-label="Unprompted, home">
          <Logo size={22} />
        </Link>
        <NavLinks />
      </div>
      {/* Disclosure sits in the header on every page, not a footer link. */}
      <p className="disclosure">
        <Disclosure />
      </p>
    </header>
  );
}

/**
 * Who runs this and what they sell.
 *
 * The operator sells the thing this chart measures, which is the conflict that
 * matters here. Naming it on every page, linked so anyone can go check, is the
 * only version of this that is worth printing.
 */
export function Disclosure() {
  return (
    <>
      Operated by{" "}
      <a href={OPERATOR_URL} target="_blank" rel="noopener">
        {OPERATOR}
      </a>
      , which sells AI visibility work. No placement on this chart is for sale.
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="shell foot-grid">
        <div className="foot-brand">
          <Link href="/" className="wordmark" aria-label="Unprompted, home">
            <Logo size={20} />
          </Link>
          <p>
            A free weekly record of which brands AI assistants recommend when
            nobody&rsquo;s paying. Every question and raw answer is public.
          </p>
        </div>
        <nav className="foot-col" aria-label="Read">
          <p className="label">Read</p>
          <Link href="/categories">Categories</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/consensus">Consensus</Link>
          <Link href="/questions">Questions and answers</Link>
        </nav>
        <nav className="foot-col" aria-label="Check">
          <p className="label">Check</p>
          <Link href="/methodology">How we measure</Link>
          <a href="https://github.com/coulditbecoley/unprompted">Source and raw data</a>
          <a href="/feed.xml">RSS feed</a>
          <a href="/llms.txt">llms.txt</a>
        </nav>
      </div>
      <div className="shell">
        <p className="mono foot-dim">
          <Disclosure />
        </p>
      </div>
    </footer>
  );
}

export function brandHref(category: string, brand: string) {
  // Category is part of the path because a brand is only meaningful inside the
  // question it was named for: ChatGPT in writing tools is a different row from
  // ChatGPT in image generators, with different rivals and a different history.
  return `/brand/${category}/${slugify(brand)}`;
}

/* -- empty state ---------------------------------------------------------- */

export function AwaitingFirstRun() {
  return (
    <section className="empty">
      <p className="label">No data yet</p>
      <h2>The first run has not happened.</h2>
      <p>
        Unprompted publishes nothing until it has measured something. There is no
        sample chart here, because a sample chart is a made-up number and this
        publication only prints real ones.
      </p>
      <p className="mono pending">Awaiting first measurement</p>
    </section>
  );
}

/* -- tone ------------------------------------------------------------------ */

/**
 * How a brand is spoken about, as a plain split.
 *
 * Deliberately drawn in the neutral greys rather than the up/down palette.
 * Green and red on this site mean movement week over week and nothing else, and
 * a positive mention is not an upward movement. It is also second-order
 * evidence, read by the extraction model rather than stated by the engine, so
 * it is never given the visual weight of a name count.
 */
export function ToneBar({
  tone,
  label = true,
}: {
  tone: { positive: number; neutral: number; negative: number; total: number };
  label?: boolean;
}) {
  const pct = (n: number) => (tone.total ? (n / tone.total) * 100 : 0);
  return (
    <>
      <span
        className="tone"
        role="img"
        aria-label={`Of ${tone.total} mentions, ${tone.positive} positive, ${tone.neutral} neutral, ${tone.negative} negative.`}
      >
        <i className="is-pos" style={{ width: `${pct(tone.positive)}%` }} />
        <i className="is-neu" style={{ width: `${pct(tone.neutral)}%` }} />
        <i className="is-neg" style={{ width: `${pct(tone.negative)}%` }} />
      </span>
      {label && (
        <span className="tone-key mono" aria-hidden="true">
          <span>
            <i className="is-pos" />
            {Math.round(pct(tone.positive))}% positive
          </span>
          <span>
            <i className="is-neu" />
            {Math.round(pct(tone.neutral))}% neutral
          </span>
          {tone.negative > 0 && (
            <span>
              <i className="is-neg" />
              {Math.round(pct(tone.negative))}% negative
            </span>
          )}
        </span>
      )}
    </>
  );
}

/* -- how to read the board ------------------------------------------------- */

/**
 * The board's key, in plain words. Every page that draws the board carries
 * it, because a newcomer meets "named", "first" and a row of squares at once
 * and none of the three explains itself.
 */
export function HowToRead({ runsPerQuestion }: { runsPerQuestion: number }) {
  return (
    <div className="howto" role="note" aria-label="How to read the board">
      <p style={{ margin: 0 }}>
        <b>
          <span className="howto-swatch" aria-hidden="true">
            <i style={{ background: "var(--cell-1)" }} />
            <i style={{ background: "var(--cell-2)" }} />
            <i style={{ background: "var(--cell-3)" }} />
            <i style={{ background: "var(--cell-4)" }} />
          </span>
          Squares
        </b>
        One per question. Darker means more of its answers named the brand
        ({runsPerQuestion} per assistant, all assistants together).
      </p>
      <p style={{ margin: 0 }}>
        <b>Named</b>
        Answers that mentioned the brand at all, out of every answer.
      </p>
      <p style={{ margin: 0 }}>
        <b>First</b>
        How often it was recommended first. The ranking uses this.
      </p>
      <p style={{ margin: 0 }}>
        <b>Δ change</b>
        Up or down since the last comparable reading. Small moves get no
        arrow: the sample cannot back them.
      </p>
      <p className="howto-more" style={{ margin: 0 }}>
        <Link href="/methodology#glossary">Every term explained →</Link>
      </p>
    </div>
  );
}

/* -- stat tiles ------------------------------------------------------------ */

export function Kpi({
  label,
  value,
  unit,
  note,
  meter,
  i = 0,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  /** 0..1, drawn as a neutral share bar under the figure. */
  meter?: number;
  i?: number;
}) {
  return (
    <div className="kpi rise" style={{ "--i": i } as React.CSSProperties}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">
        {value}
        {unit && <small>{unit}</small>}
      </p>
      {note && <p className="kpi-note">{note}</p>}
      {meter !== undefined && (
        <span className="meter" aria-hidden="true">
          <i style={{ "--v": meter, "--i": i } as React.CSSProperties} />
        </span>
      )}
    </div>
  );
}

/* -- top of the board as bars --------------------------------------------- */

/**
 * The leaders as two bars each: how often named at all, and how often first.
 * Drawn side by side because the gap between them is the finding the mark
 * encodes -- the brand named most is often not the one recommended first.
 */
export function LeaderBars({
  rows,
  hrefFor,
  start = 0,
  highlight,
}: {
  rows: BrandStanding[];
  hrefFor: (brand: string) => string;
  /** Board rank of the first row, when showing a slice from the middle. */
  start?: number;
  highlight?: string;
}) {
  return (
    <div className="lb panel">
      <div className="lb-key mono" aria-hidden="true">
        <span><i className="lb-sw is-named" />Named in any answer</span>
        <span><i className="lb-sw is-first" />Named first</span>
      </div>
      {rows.map((r, i) => (
        <div className="lb-row reveal" key={r.brand} data-on={r.brand === highlight}>
          <Link className="lb-brand" href={hrefFor(r.brand)}>
            <span className="mono lb-rank">{String(start + i + 1).padStart(2, "0")}</span>
            {r.brand}
          </Link>
          <div
            className="lb-bars"
            role="img"
            aria-label={`${r.brand}: named in ${Math.round(r.rotation * 100)}% of answers, named first in ${Math.round(r.firstShare * 100)}%.`}
          >
            <span className="lb-bar">
              <span className="meter" data-tone="soft">
                <i style={{ "--v": r.rotation, "--i": i } as React.CSSProperties} />
              </span>
              <span className="mono">{Math.round(r.rotation * 100)}%</span>
            </span>
            <span className="lb-bar">
              <span className="meter">
                <i style={{ "--v": r.firstShare, "--i": i + 1 } as React.CSSProperties} />
              </span>
              <span className="mono">{Math.round(r.firstShare * 100)}%</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Each assistant's own favourite, one card per assistant. The board pools every
 * engine; this is the quickest way to see that they do not all agree.
 */
export function TopPicks({
  picks,
  labels,
  hrefFor,
}: {
  picks: Array<{ engine: string; brands: string[]; first: number; of: number }>;
  labels: Map<string, string>;
  hrefFor: (brand: string) => string;
}) {
  const brands = [...new Set(picks.flatMap((p) => p.brands))];
  const ties = picks.some((p) => p.brands.length > 1);
  const list = brands.join(", ").replace(/, ([^,]*)$/, " and $1");
  return (
    <>
      <p className="section-lead" style={{ marginBottom: 16 }}>
        {brands.length === 1
          ? `Every assistant put ${brands[0]} first more often than anything else.`
          : `Taken one at a time, the ${picks.length} assistants split between ${brands.length} favourites: ${list}.`}
        {ties && " Where two brands were put first equally often, both are shown."}
      </p>
      <div className="pick-grid">
        {picks.map((p, i) => (
          <div key={p.engine} className="pick-card rise" style={{ "--i": i } as React.CSSProperties}>
            <span className="label">{labels.get(p.engine) ?? p.engine}</span>
            <span className="pick-brand">
              {p.brands.map((b, j) => (
                <span key={b}>
                  {j > 0 && <span className="pick-tie"> tied with </span>}
                  <Link href={hrefFor(b)}>{b}</Link>
                </span>
              ))}
            </span>
            <span className="meter" aria-hidden="true"><i style={{ "--v": p.first / p.of } as React.CSSProperties} /></span>
            <span className="pick-note">
              first in {p.first} of {p.of} answers{p.brands.length > 1 ? " each" : ""}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Two sentences a newcomer would otherwise have to work out from the board:
 * whether the lead is real at this sample size, and which brand is mentioned
 * far more often than it is picked first. Decided by `boardTakeaways`.
 */
export function Insights({ board }: { board: BrandStanding[] }) {
  const { lead, gap } = boardTakeaways(board);
  const pct = (v: number) => Math.round(v * 100);
  const items: React.ReactNode[] = [];
  if (lead?.kind === "level") {
    items.push(
      <>
        <b>{lead.a.brand}</b> and <b>{lead.b.brand}</b> are level on first picks, at {pct(lead.a.firstShare)}% each.
      </>,
    );
  } else if (lead) {
    // Points from the printed (rounded) figures, so the sentence matches them.
    const pa = pct(lead.a.firstShare);
    const pb = pct(lead.b.firstShare);
    const verdict = lead.clear
      ? "That gap is larger than the noise at this sample size."
      : "At this sample size that is too close to call: treat them as level.";
    items.push(
      pa === pb ? (
        <>
          <b>{lead.a.brand}</b> was named first in {lead.answers} more answer{lead.answers === 1 ? "" : "s"} than{" "}
          <b>{lead.b.brand}</b>; both round to {pa}%. {verdict}
        </>
      ) : (
        <>
          <b>{lead.a.brand}</b> leads <b>{lead.b.brand}</b> by {pa - pb} point{pa - pb === 1 ? "" : "s"} on first
          picks ({pa}% to {pb}%). {verdict}
        </>
      ),
    );
  }
  if (gap) {
    items.push(
      <>
        <b>{gap.brand}</b> comes up in {pct(gap.rotation)}% of answers but is named first in{" "}
        {pct(gap.firstShare)}%: the widest gap in the top eight between being mentioned and being the
        first pick.
      </>,
    );
  }
  if (!items.length) return null;
  return (
    <div className="insights panel">
      <p className="label">What stands out</p>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
