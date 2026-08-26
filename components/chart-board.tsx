import Link from "next/link";

import { LiveBoard } from "@/components/board-live";
import { Freshness, ShareRow } from "@/components/freshness";
import { Subscribe } from "@/components/subscribe";
import { AwaitingFirstRun, StatusBar, TrimTop, brandHref } from "@/components/ui";
import type { Category, Sector } from "@/lib/categories";
import { loadProviders } from "@/lib/providers";
import {
  answeredPerQuestion,
  latestRun,
  loadAffiliations,
  loadHistory,
  loadQuestionText,
  movement,
  questionOrder,
  selfPreference,
  shortfall,
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

  /*
    Engines that did not answer everything they were asked this week. Empty on a
    normal week, which is when the sentence above is true as written.

    Named from the registry so this reads as prose rather than as ids -- and
    falling back to the id, because an engine retired from providers.json still
    appears in the weeks it measured, and a week's record must not lose the name
    of the thing that produced it.
  */
  const engineLabels = new Map(loadProviders().map((p) => [p.id, p.label]));
  const missed = shortfall(run).map((c) => ({
    ...c,
    label: engineLabels.get(c.engine) ?? c.engine,
  }));

  const board = standings(run);
  const prev = history.length > 1 ? standings(history[history.length - 2]) : [];
  const moves = movement(board, prev);
  const moveFor = new Map(moves.map((m) => [m.brand, m]));
  const snub = theSnub(moves);
  const sources = sourceCounts(run).slice(0, 10);
  const leader = board[0];
  const preference = selfPreference(run, loadAffiliations(category.slug));

  // Read once. Called inside the map below, this re-read and re-parsed the
  // whole question file for every question on the board.
  const text = loadQuestionText(category.slug);
  const questionText = questionOrder(run).map((id) => text[id] ?? id);

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

      {/*
        And when it does not match, say so here rather than leaving the sentence
        above to overstate the week. An engine that fell short is a smaller
        sample, not a wrong one: every percentage on this page divides by the
        calls that were answered, so a call that failed is left out rather than
        counted as "this brand was not named".

        Computed from the run, so it appears on any week it applies to and
        disappears on any week it does not.
      */}
      {missed.length > 0 && (
        <p className="section-lead coverage-note">
          <strong>Not a full week.</strong>{" "}
          {missed.map((c, i) => (
            <span key={c.engine}>
              {i > 0 ? ", and " : ""}
              {c.label} answered {c.answered} of {c.attempted}
            </span>
          ))}
          . The {missed.reduce((n, c) => n + (c.attempted - c.answered), 0)} calls
          that did not come back are excluded from every figure below rather than
          counted against a brand, so the percentages are read from a smaller
          sample than the line above describes.
        </p>
      )}

      <StatusBar
        runDate={run.run_date}
        engines={run.engines}
        methodVersion={run.method_version}
        runsPerQuestion={run.runs_per_question}
      />
      <Freshness runDate={run.run_date} />

      <LiveBoard
        questions={questionText}
        denominators={answeredPerQuestion(run)}
        rows={board.map((b, i) => ({
          standing: b,
          rank: i + 1,
          move: moveFor.get(b.brand),
          href: brandHref(category.slug, b.brand),
        }))}
      />

      <ShareRow
        headline={
          leader
            ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of runs about ${category.label.toLowerCase()}.`
            : "What AI recommends when nobody's paying."
        }
      />

      {snub && (
        <div className="snub">
          <p className="label" style={{ color: "var(--down)" }}>
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
