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
// From lib/shared, not lib/data: this file is imported by a client component,
// and lib/data reads the repository with node:fs.
import { DISCLOSURE, OPERATOR, OPERATOR_URL, slugify } from "@/lib/shared";

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
}: {
  standing: BrandStanding;
  rank: number;
  move?: Movement;
  href?: string;
  /** Which question column is being read, if any. See LiveBoard. */
  activeStep?: number | null;
  onStep?: (step: number | null) => void;
}) {
  const name = href ? (
    <Link href={href} style={{ textDecoration: "none" }}>
      {standing.brand}
    </Link>
  ) : (
    standing.brand
  );

  return (
    <div className="seq-row">
      <span className="mono seq-rank" data-lead={rank === 1}>
        {String(rank).padStart(2, "0")}
      </span>
      {/* The rotation bar makes the ordering readable without reading a number.
          Deliberately neutral: colour on this board means movement. */}
      <span className="seq-brand">
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
        role="img"
        aria-label={`Named in ${standing.named} of ${standing.totalRuns} runs, across ${standing.steps.length} questions`}
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
            style={{ animationDelay: `${i * 30}ms` }}
          />
        ))}
      </span>

      <span className="mono seq-rot">
        {standing.named}/{standing.totalRuns}
      </span>
      <span className="mono seq-first" data-lead={rank === 1}>
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
  if (!move) return <span className="mono seq-delta" />;
  if (move.isNew) return <span className="mono seq-delta is-new">NEW</span>;
  if (move.rotationDelta === 0) return <span className="mono seq-delta">—</span>;

  const up = move.rotationDelta > 0;

  // A change this sample cannot support gets its number and neither the arrow
  // nor the colour. Both of those are the site saying "this happened", and on a
  // fifteen-question week a few points often did not: the figure is still shown
  // because hiding it would be its own kind of dishonesty.
  if (!move.significant) {
    return (
      <span
        className="mono seq-delta is-noise"
        title="Within the noise of this sample. Reported, not called a move."
      >
        {up ? "+" : "−"}
        {Math.abs(move.rotationDelta)}
      </span>
    );
  }

  return (
    <span className={`mono seq-delta ${up ? "is-up" : "is-down"}`}>
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
      <span className="mono">RUN {runDate}</span>
      <span className="mono">METHOD v{methodVersion}</span>
      <span className="mono">{runsPerQuestion} RUNS/Q</span>
      <span className="mono">
        {engines.length} ENGINE{engines.length === 1 ? "" : "S"}: {engines.join(" · ").toUpperCase()}
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
      <div className="shell">
        <p className="mono">
          Unprompted · what AI recommends when nobody&rsquo;s paying ·{" "}
          <a href="https://github.com/coulditbecoley/unprompted">source and data</a> ·{" "}
          <a href="/feed.xml">RSS</a>
        </p>
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
