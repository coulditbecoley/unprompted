import { SectionLink } from "@/components/contact";
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
import { AwaitingFirstRun, Kpi, StatusBar } from "@/components/ui";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";

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
    title: `Do AI assistants agree? ${label}`,
    openGraph: { title: `Do AI assistants agree? ${label}`, description: "Compare each assistant?s first pick, question by question." },
    description: `Which brand each AI assistant names first, question by question, for ${inSentence(label)}. Where they agree, and where they do not.`,
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
        <h1 className="display page-title rise">Do the assistants agree?</h1>
        <AwaitingFirstRun />
        <a className="btn" href="/categories">Browse available results</a>
      </section>
    );
  }

  const rows = consensus(run, loadQuestionText(category, run));
  const score = consensusScore(rows);
  const divergence = engineDivergence(rows);
  const engines = rows[0]?.picks.map((p) => p.engine) ?? [];
  const contested = rows.filter((r) => !r.settled);
  const labels = new Map(loadProviders().map(p => [p.id, p.label]));

  return (
    <section className="shell section">
      <CategoryTabs category={category} />

      <h1 className="display page-title rise cns-title">
        {engines.length < 2 ? (
          <>Too few AI assistants to compare.</>
        ) : (
          <>
            AI assistants agree on {score.settled} of {score.total} questions.
          </>
        )}
      </h1>
      <p className="section-lead cns-lead">
        {engines.length < 2 ? (
          <>
            This page compares which brands AI assistants name first. We need
            answers from at least two assistants to measure agreement.
          </>
        ) : (
          <>
            See whether different AI assistants name the same brand first, or
            whether your choice of assistant could change the answer.
            {" "}{categoryLabel(category)}, measured on{" "}
            {run.measured_on || run.run_date}.
          </>
        )}
      </p>
      <p className="cmp-note">
        An engine is an AI assistant accessed through its API or command-line
        tool. Its pick is the brand it names first most often across repeated
        answers. Agreement means every engine has the same pick; it does not
        establish which product is best.
      </p>

      <div style={{ marginTop: 20 }}>
        <StatusBar
          runDate={run.run_date}
          engines={run.engines.map(e => labels.get(e) ?? e)}
          methodVersion={run.method_version}
          runsPerQuestion={run.runs_per_question}
        />
      </div>

      {engines.length >= 2 && (
        <>
          <div className="kpi-row">
            <Kpi value={Math.round(score.share * 100)} unit="%" label="Full agreement" meter={score.share} note={`${score.settled} of ${score.total} questions.`} />
            <Kpi i={1} value={contested.length} label="Without full agreement" note="Different picks, ties, or missing picks." />
            <Kpi i={2} value={engines.length} label="Engines compared" note="Each engine contributes one pick per question." />
          </div>
          <div className="panel cns-agreement reveal">
            <h2 className="sub-h" id="agreement">Agreement at a glance</h2>
            <p className="cmp-note">One square per question. Filled squares mean every engine picked the same brand.</p>
            <div className="cns-strip" role="img" aria-label={`${score.settled} of ${score.total} questions have full agreement.`}>
              {rows.map(row => <span key={row.questionId} data-agreed={row.settled} title={`${row.text}: ${row.settled ? 'all agree' : 'no full agreement'}`} />)}
            </div>
          </div>

          <h2 className="sub-h" id="questions">Question by question <SectionLink id="questions" label="Question by question" /></h2>
          {!run.methodology?.questions && <p className="cmp-note">Legacy reading: question wording comes from the current bank; historical wording was not recorded.</p>}
          <p className="cmp-note">
            The percentage shows how often the leading brand was named first
            among usable answers to that question. A dash means a tie or no
            pick. Bold marks picks outside the majority, or all picks when
            there is no majority. Missing picks also prevent full agreement.
          </p>

          <div className="panel cns reveal" role="table" aria-label="Assistant picks by question" tabIndex={0}>
            <div
              className="cns-row cns-head"
              role="row"
              style={{ "--engines": engines.length } as React.CSSProperties}
            >
              <span className="label" role="columnheader">Question</span>
              {engines.map((engine) => (
                <span className="label cns-engine" role="columnheader" key={engine}>
                  {labels.get(engine) ?? engine}
                </span>
              ))}
              <span className="label cns-verdict" role="columnheader">Verdict</span>
            </div>

            {rows.map((row) => (
              <Row key={row.questionId} row={row} engines={engines.length} labels={labels} />
            ))}
          </div>

          <h2 className="sub-h" id="differences">How often each engine differs from the majority <SectionLink id="differences" label="How often each engine differs from the majority" /></h2>
          <p className="cmp-note">
            The count is questions where a majority chose a brand and this
            engine chose another brand or had no pick, out of all questions
            shown. Questions without a majority add no differences.
          </p>
          <div className="panel cns-div reveal">
            {divergence.map((d) => (
              <div className="cns-div-row" key={d.engine}>
                <span className="cns-div-name">{labels.get(d.engine) ?? d.engine}</span>
                <span className="meter" aria-hidden="true">
                  <i style={{ "--v": d.differs / Math.max(d.of, 1) } as React.CSSProperties} />
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

function Row({ row, engines, labels }: { row: QuestionConsensus; engines: number; labels: Map<string, string> }) {
  // Three engines naming three different brands has no majority worth marking,
  // so every pick is flagged as divergent, which is the honest reading.
  const threeWay = row.agree <= 1 && row.picks.length > 1;

  return (
    <div className="cns-row" role="row" style={{ "--engines": engines } as React.CSSProperties}>
      <span className="cns-q" role="rowheader">{row.text}</span>
      {row.picks.map((pick) => {
        const differs = !row.settled && (threeWay || pick.brand !== row.majority);
        return (
          <span className="cns-pick" role="cell" key={pick.engine} data-differs={differs}>
            <span className="sr-only">{labels.get(pick.engine) ?? pick.engine}: </span>
            {pick.brand ?? "—"}
            <i className="cns-share mono">
              {Math.round(pick.share * 100)}%
              <span className="sr-only"> named first</span>
            </i>
            <span className="meter cns-pick-meter" data-tone="soft" aria-hidden="true"><i style={{ "--v": pick.share } as React.CSSProperties} /></span>
          </span>
        );
      })}
      <span className="mono cns-verdict" role="cell" data-settled={row.settled}>
        {row.settled ? "Agree ?" : "Split"}
      </span>
    </div>
  );
}
