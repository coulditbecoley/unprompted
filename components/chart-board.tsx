import Link from "next/link";

import { Freshness, ShareRow } from "@/components/freshness";
import { Subscribe } from "@/components/subscribe";
import {
  AwaitingFirstRun,
  SequencerHead,
  SequencerRow,
  StatusBar,
  TrimTop,
  brandHref,
} from "@/components/ui";
import type { Category, Sector } from "@/lib/categories";
import {
  latestRun,
  loadAffiliations,
  loadHistory,
  movement,
  selfPreference,
  sourceCounts,
  standings,
  theSnub,
} from "@/lib/data";

/**
 * One category's board.
 *
 * Extracted from the single hardcoded chart page so adding a category is a
 * registry entry plus two YAML files, with no new UI. Every category renders
 * through this, including the flagship.
 */
export function ChartBoard({
  category,
  sector,
}: {
  category: Category;
  sector?: Sector;
}) {
  const run = latestRun(category.slug);
  const history = loadHistory(category.slug);

  if (!run) {
    return (
      <section className="shell">
        <p className="label" style={{ paddingTop: 40 }}>
          {sector ? `${sector.label} · ` : ""}
          {category.label}
        </p>
        <AwaitingFirstRun />
        <p className="mono" style={{ fontSize: 12.5 }}>
          <Link href="/categories">← Browse every category</Link>
        </p>
      </section>
    );
  }

  const board = standings(run);
  const prev = history.length > 1 ? standings(history[history.length - 2]) : [];
  const moves = movement(board, prev);
  const moveFor = new Map(moves.map((m) => [m.brand, m]));
  const snub = theSnub(moves);
  const sources = sourceCounts(run).slice(0, 10);
  const leader = board[0];
  const preference = selfPreference(run, loadAffiliations(category.slug));

  return (
    <section className="shell section">
      <p className="label">
        {sector && (
          <>
            <Link href="/categories" style={{ color: "inherit" }}>
              {sector.label}
            </Link>
            {" · "}
          </>
        )}
        {category.label}
      </p>

      <h1 style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, margin: "6px 0 10px" }}>
        {leader
          ? `${leader.brand} leads, named first in ${Math.round(leader.firstShare * 100)}% of runs.`
          : "No brand was named this week."}
      </h1>

      {/* This sentence has to match what the board actually draws. */}
      <p className="section-lead">
        Week of {run.run_date}. One step per question, {run.runs_per_question} runs
        each across {run.engines.length} engine
        {run.engines.length === 1 ? "" : "s"}. A taller step means the brand was
        named more often for that question.
      </p>

      <StatusBar
        runDate={run.run_date}
        engines={run.engines}
        methodVersion={run.method_version}
        runsPerQuestion={run.runs_per_question}
      />
      <Freshness runDate={run.run_date} />

      <div className="seq-board" style={{ marginTop: 14 }}>
        <TrimTop />
        <SequencerHead />
        {board.map((b, i) => (
          <SequencerRow
            key={b.brand}
            standing={b}
            rank={i + 1}
            move={moveFor.get(b.brand)}
            href={brandHref(b.brand)}
          />
        ))}
      </div>

      <ShareRow
        headline={
          leader
            ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of runs about ${category.label.toLowerCase()}.`
            : "What AI recommends when nobody's paying."
        }
      />

      {snub && (
        <div className="snub">
          <p className="label" style={{ color: "var(--amber)" }}>
            The Snub
          </p>
          <h3>{snub.brand}</h3>
          <p>
            {snub.isDropout
              ? "Named last week. Not named once this week."
              : `Down ${Math.abs(snub.rotationDelta)} points week over week.`}
          </p>
        </div>
      )}

      {preference.length > 0 && (
        <>
          <h2 style={{ fontSize: 22, marginTop: 44, marginBottom: 6 }}>
            Does an engine favour its own tool?
          </h2>
          <p className="section-lead">
            Some of the products above are made by the same companies whose
            assistants we ask. This compares how often an engine named its own
            product against how often every other engine named it. A gap is a
            measurement, not an accusation, and a small gap on this sample size
            is noise.
          </p>
          <div className="seq-board">
            <TrimTop />
            {preference.map((p) => (
              <div className="sp-row" key={p.brand}>
                <span className="sp-brand">
                  {p.brand}
                  <small>made by {p.engine}</small>
                </span>
                <span className="sp-num">
                  <small>ITS OWN</small>
                  {Math.round(p.ownRate * 100)}%
                  <small style={{ marginTop: 3 }}>
                    {p.ownNamed}/{p.ownRuns}
                  </small>
                </span>
                <span className="sp-num sp-rival">
                  <small>RIVALS</small>
                  {Math.round(p.rivalRate * 100)}%
                  <small style={{ marginTop: 3 }}>
                    {p.rivalNamed}/{p.rivalRuns}
                  </small>
                </span>
                <span
                  className="sp-gap"
                  data-sign={p.gap > 0 ? "up" : p.gap < 0 ? "down" : "flat"}
                  title="Percentage points by which the owner out-names everyone else"
                >
                  {p.gap > 0 ? "+" : ""}
                  {p.gap}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {sources.length > 0 && (
        <>
          <h2 style={{ fontSize: 22, marginTop: 44, marginBottom: 6 }}>
            What the answers were built from
          </h2>
          <p className="section-lead">
            The domains these assistants cited most while answering. This is where
            the recommendations actually come from.
          </p>
          <div className="seq-board">
            <TrimTop />
            {sources.map(([host, count]) => (
              <div className="seq-row" key={host} style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="mono" style={{ fontSize: 14 }}>
                  {host}
                </span>
                <span className="mono" style={{ fontSize: 13, color: "var(--fg-2)" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Subscribe />
    </section>
  );
}
