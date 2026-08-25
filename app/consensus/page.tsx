import type { Metadata } from "next";

import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import {
  categoryLabel,
  consensus,
  consensusScore,
  engineDivergence,
  latestRun,
  loadQuestionText,
  type QuestionConsensus,
} from "@/lib/data";
import { AwaitingFirstRun, StatusBar, TrimTop } from "@/components/ui";

type Params = { c?: string };

/**
 * Do the machines agree?
 *
 * The board answers "what does AI recommend". This answers "which AI", which is
 * the question the board flattens: asked what the best AI coding assistant is,
 * one engine names Copilot, one names Claude Code and one names Cursor. A
 * single ranking hides that completely, and no competing tool publishes it.
 *
 * Read, not Operate. There is one control, the category, and everything else is
 * there to be understood rather than driven.
 */

function resolve(params: Params) {
  return params.c && getCategory(params.c) ? params.c : DEFAULT_CATEGORY;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const category = resolve(await searchParams);
  const label = categoryLabel(category);
  return {
    title: `Do the engines agree? ${label}`,
    description: `Which brand each AI assistant names first, question by question, for ${label.toLowerCase()}. Where they agree, and where they do not.`,
  };
}

export default async function ConsensusPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const category = resolve(await searchParams);
  const run = latestRun(category);

  if (!run) {
    return (
      <section className="shell section">
        <CategoryTabs category={category} />
        <AwaitingFirstRun />
      </section>
    );
  }

  const rows = consensus(run, loadQuestionText(category));
  const score = consensusScore(rows);
  const divergence = engineDivergence(rows);
  const engines = rows[0]?.picks.map((p) => p.engine) ?? [];
  const contested = rows.filter((r) => !r.settled);

  return (
    <section className="shell section">
      <CategoryTabs category={category} />

      <h1 className="display cns-title">
        {engines.length < 2 ? (
          <>One engine answered this week.</>
        ) : (
          <>
            The engines agree on {score.settled} of {score.total} questions.
          </>
        )}
      </h1>
      <p className="section-lead cns-lead">
        {engines.length < 2 ? (
          <>
            Agreement needs at least two engines to mean anything. This week&rsquo;s
            run had one, so there is nothing to compare yet.
          </>
        ) : (
          <>
            Each engine&rsquo;s pick is the brand it named first most often across
            its repeats. Where every engine picks the same brand, the question is
            settled. Where they split, the answer a buyer gets depends on which
            assistant they happened to ask. {categoryLabel(category)}, week of{" "}
            {run.run_date}.
          </>
        )}
      </p>

      <div style={{ marginTop: 20 }}>
        <StatusBar
          runDate={run.run_date}
          engines={run.engines}
          methodVersion={run.method_version}
          runsPerQuestion={run.runs_per_question}
        />
      </div>

      {engines.length >= 2 && (
        <>
          <div className="cns-summary">
            <Stat value={`${Math.round(score.share * 100)}%`} label="questions settled" />
            <Stat value={String(contested.length)} label="questions split" />
            <Stat value={String(engines.length)} label="engines compared" />
          </div>

          <h2 className="cmp-h2">Question by question</h2>
          <p className="cmp-note">
            A pick set in full weight is one that differs from what the other
            engines chose. Colour is not used here, so a split reads the same in
            greyscale or in a screenshot.
          </p>

          <div className="panel cns">
            <div
              className="cns-row cns-head"
              style={{ "--engines": engines.length } as React.CSSProperties}
            >
              <span className="label">Question</span>
              {engines.map((engine) => (
                <span className="label cns-engine" key={engine}>
                  {engine}
                </span>
              ))}
              <span className="label cns-verdict">Verdict</span>
            </div>

            {rows.map((row) => (
              <Row key={row.questionId} row={row} engines={engines.length} />
            ))}
          </div>

          <h2 className="cmp-h2">Where each engine breaks from the pack</h2>
          <p className="cmp-note">
            How often an engine&rsquo;s pick differs from the brand most engines
            chose. Reported per engine rather than naming one contrarian, because
            the odd one out changes from question to question.
          </p>
          <div className="panel cns-div">
            {divergence.map((d) => (
              <div className="cns-div-row" key={d.engine}>
                <span className="mono cns-div-name">{d.engine}</span>
                <span className="cns-div-track" aria-hidden="true">
                  <i style={{ width: `${(d.differs / Math.max(d.of, 1)) * 100}%` }} />
                </span>
                <span className="mono cns-div-fig">
                  {d.differs}/{d.of}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* -- pieces ---------------------------------------------------------------- */

function CategoryTabs({ category }: { category: string }) {
  return (
    <nav className="cat-tabs" aria-label="Category">
      {CATEGORIES.map((c) => (
        <a
          key={c.slug}
          href={`/consensus?c=${c.slug}`}
          className="cat-tab"
          aria-current={c.slug === category ? "page" : undefined}
        >
          {c.label}
        </a>
      ))}
    </nav>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="cns-stat">
      <TrimTop />
      <span className="mono cns-stat-v">{value}</span>
      <span className="cns-stat-l">{label}</span>
    </div>
  );
}

function Row({ row, engines }: { row: QuestionConsensus; engines: number }) {
  // Three engines naming three different brands has no majority worth marking,
  // so every pick is flagged as divergent, which is the honest reading.
  const threeWay = row.agree <= 1 && row.picks.length > 1;

  return (
    <div className="cns-row" style={{ "--engines": engines } as React.CSSProperties}>
      <span className="cns-q">{row.text}</span>
      {row.picks.map((pick) => {
        const differs = !row.settled && (threeWay || pick.brand !== row.majority);
        return (
          <span className="cns-pick" key={pick.engine} data-differs={differs}>
            <span className="sr-only">{pick.engine}: </span>
            {pick.brand ?? "—"}
            <i className="cns-share mono" aria-hidden="true">
              {Math.round(pick.share * 100)}%
            </i>
          </span>
        );
      })}
      <span className="mono cns-verdict" data-settled={row.settled}>
        {row.settled ? "Agreed" : threeWay ? `Split ${row.picks.length}` : "Split"}
      </span>
    </div>
  );
}
