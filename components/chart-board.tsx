import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveBoard } from "@/components/board-live";
import { Freshness, ShareRow } from "@/components/freshness";
import { Subscribe } from "@/components/subscribe";
import { AwaitingFirstRun, HowToRead, Kpi, LeaderBars, StatusBar, TopPicks, TrimTop, brandHref } from "@/components/ui";
import type { Category, Sector } from "@/lib/categories";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";
import {
  answeredPerQuestion,
  comparisonReason,
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
  topPickByEngine,
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
  date,
}: {
  category: Category;
  sector?: Sector;
  date?: string;
}) {
  const history = loadHistory(category.slug, true);
  const run = date ? history.find(r => r.run_date === date) : latestRun(category.slug);
  if (date && !run) notFound();

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
    Engines with fewer usable readings than recorded attempts. This includes
    call failures, extraction errors and refusals, not just missing responses.

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
  const picks = topPickByEngine(run);
  const older = loadHistory(category.slug).filter(r => (r.measured_on || r.run_date) < (run.measured_on || run.run_date)).at(-1);
  const comparisonNote = comparisonReason(run, older);
  const baselineDate = older?.measured_on || older?.run_date;
  const moves = older && comparisonNote === null ? movement(board, standings(older)) : [];
  const moveFor = new Map(moves.map((m) => [m.brand, m]));
  const snub = theSnub(moves);
  const sources = sourceCounts(run).slice(0, 10);
  const leader = board[0];
  const preference = selfPreference(run, loadAffiliations(category.slug, run));

  // Read once. Called inside the map below, this re-read and re-parsed the
  // whole question file for every question on the board.
  const text = loadQuestionText(category.slug, run);
  const questionText = questionOrder(run).map((id) => text[id] ?? id);

  const engineNames = run.engines.map((e) => engineLabels.get(e) ?? e);
  const answered = answeredPerQuestion(run).reduce((x, y) => x + y, 0);
  const maxSource = sources[0]?.[1] ?? 1;

  return (
    <section className="shell section">
      {/* Machine-readable summary of the same figures the page prints, so a
          search engine or an assistant can cite the week without scraping. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `${category.label}: which brands AI assistants recommend (${run.measured_on || run.run_date})`,
            description: `How often ${engineNames.join(", ")} named each brand across ${questionText.length} buying questions about ${inSentence(category.label)}, ${run.runs_per_question} runs each.`,
            url: `https://unprompted.report/chart/${category.slug}/${run.run_date}`,
            dateModified: run.measured_on || run.run_date,
            isAccessibleForFree: true,
            license: "https://github.com/coulditbecoley/unprompted/blob/main/LICENSE",
            creator: { "@type": "Organization", name: "Unprompted", url: "https://unprompted.report" },
            variableMeasured: board.slice(0, 10).map((b) => ({
              "@type": "PropertyValue",
              name: b.brand,
              value: Math.round(b.firstShare * 100),
              unitText: "percent of runs named first",
            })),
          }).replace(/</g, "\\u003c"),
        }}
      />
      <nav className="crumbs label" aria-label="Breadcrumb">
        <Link href="/categories">{sector ? sector.label : "Categories"}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{category.label}</span>
      </nav>

      <h1 className="display page-title rise">
        {leader
          ? <>{leader.brand} leads, named first in <span className="verdict-num">{Math.round(leader.firstShare * 100)}%</span> of runs.</>
          : "No brand was named this week."}
      </h1>

      {/* This sentence has to match what the board actually draws. */}
      <p className="section-lead rise" style={{ "--i": 1 } as React.CSSProperties}>
        We asked {engineNames.join(", ")} {questionText.length} questions about{" "}
        {inSentence(category.label)}, {run.runs_per_question} times each, on{" "}
        {run.measured_on || run.run_date}. Below is how often each brand came up, and how
        often it was the first one recommended.
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
          <strong>Smaller sample this week.</strong>{" "}
          {missed.map((c, i) => (
            <span key={c.engine}>
              {i > 0 ? ", and " : ""}
              {c.label}: {c.answered} usable answers from {c.attempted} attempts
            </span>
          ))}
          . {missed.reduce((n, c) => n + (c.attempted - c.answered), 0)} answers were
          left out because the call failed, the assistant refused, or the answer could
          not be read. They are not counted as answers that skipped a brand.
        </p>
      )}

      <div className="kpi-row">
        {leader && <Kpi i={0} label="Leader" value={leader.brand} note={`First pick in ${Math.round(leader.firstShare * 100)}% of runs`} meter={leader.firstShare} />}
        <Kpi i={1} label="Answers read" value={answered.toLocaleString("en-US")} note={`${questionText.length} questions × ${run.runs_per_question} runs × ${run.engines.length} assistants`} />
        <Kpi i={2} label="Brands named" value={board.length} note="Every product any assistant brought up." />
        <Kpi i={3} label="Readings on file" value={history.length} note={history.length > 1 ? `Since ${history[0].run_date}` : "This is the first one."} />
      </div>

      <div className="btn-row" style={{ margin: "4px 0 6px" }}>
        <Link className="btn btn-sm" href={`/questions?c=${category.slug}&date=${run.run_date}`}>
          Read the answers <span className="arr" aria-hidden="true">→</span>
        </Link>
        <Link className="btn btn-sm btn-ghost" href={`/chart/${category.slug}/${run.run_date}`}>Permanent link</Link>
        {history.length > 1 && (
          <details className="readings">
            <summary className="btn btn-sm btn-ghost">Past readings ({history.length})</summary>
            <ul className="readings-list panel">
              {history.slice().reverse().map(r => (
                <li key={r.run_date}>
                  <Link href={`/chart/${category.slug}/${r.run_date}`} aria-current={r.run_date === run.run_date ? "page" : undefined}>
                    {r.run_date}{r.source_run ? " · reprocessed" : ""}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <StatusBar
        runDate={run.run_date}
        engines={engineNames}
        methodVersion={run.method_version}
        runsPerQuestion={run.runs_per_question}
      />
      <Freshness runDate={run.measured_on || run.run_date} />
      {!run.methodology?.questions && <p className="cmp-note">Older reading: question wording comes from the current question list, because the wording used at the time was not saved.</p>}
      <p className="cmp-note">{comparisonNote ?? <>Change is measured against <Link href={`/chart/${category.slug}/${older!.run_date}`}>{baselineDate}</Link>.</>}</p>
      <HowToRead runsPerQuestion={run.runs_per_question} />

      <LiveBoard
        evidenceUrl={`/questions?c=${category.slug}&date=${run.run_date}`}
        questions={questionText}
        denominators={answeredPerQuestion(run)}
        rows={board.map((b, i) => ({
          standing: { ...b, cells: [] },
          rank: i + 1,
          move: moveFor.get(b.brand),
          href: brandHref(category.slug, b.brand),
        }))}
      />

      <ShareRow
        url={`https://unprompted.report/chart/${category.slug}/${run.run_date}`}
        headline={
          leader
            ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of runs about ${inSentence(category.label)}.`
            : "What AI recommends when nobody's paying."
        }
      />

      {board.length > 1 && (
        <div className="reveal" style={{ marginTop: 44 }}>
          <h2 className="sub-h">Mentioned often vs. recommended first</h2>
          <p className="section-lead" style={{ marginBottom: 14 }}>
            Pale bar: how often the brand came up at all. Solid bar: how often it was the
            first pick. A big gap means the assistants know it but reach for something else first.
          </p>
          <LeaderBars rows={board.slice(0, 8)} hrefFor={(b) => brandHref(category.slug, b)} />
        </div>
      )}

      {picks.length > 1 && (
        <div className="reveal" style={{ marginTop: 44 }}>
          <h2 className="sub-h">Each assistant&rsquo;s favourite</h2>
          <TopPicks picks={picks} labels={engineLabels} hrefFor={(b) => brandHref(category.slug, b)} />
        </div>
      )}

      {snub && (
        <div className="snub reveal">
          <p className="label" style={{ color: "var(--down)" }}>
            Biggest drop
          </p>
          <h3>{snub.brand}</h3>
          <p>
            {snub.isDropout
              ? `Named on ${baselineDate}. Not named at all this time.`
              : `Named in ${Math.abs(snub.rotationDelta)} points fewer answers than on ${baselineDate}.`}
          </p>
        </div>
      )}

      {preference.length > 0 && (
        <>
          <h2 className="sub-h reveal">
            Does an assistant favour its own product?
          </h2>
          <p className="section-lead">
            Some products here are made by the same companies whose assistants we ask.
            This compares how often an assistant named its own product with how often
            the other assistants did. A gap is a measurement, not an accusation, and a
            small gap on this sample is noise.
          </p>
          <div className="seq-board reveal">
            <TrimTop />
            {preference.map((p) => (
              <div className="sp-row" key={p.brand}>
                <span className="sp-brand">
                  {p.brand}
                  {/* One brand can belong to two engines ("claude, claude-code"); name each. */}
                  <small>made by the company behind {p.engine.split(", ").map((e) => engineLabels.get(e) ?? e).join(" and ")}</small>
                  <span className="sp-meters" aria-hidden="true">
                    <span className="meter"><i style={{ "--v": p.ownRate } as React.CSSProperties} /></span>
                    <span className="meter" data-tone="soft"><i style={{ "--v": p.rivalRate } as React.CSSProperties} /></span>
                  </span>
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
          <h2 className="sub-h reveal">
            Sites the assistants drew on
          </h2>
          <p className="section-lead">
            The websites that came up most often, as citations in the answers or
            as search results the assistants pulled. This shows where they looked,
            not proof of why they recommended anything.
          </p>
          <div className="seq-board reveal">
            <TrimTop />
            {sources.map(([host, count]) => (
              <div className="seq-row src-row" key={host}>
                <span className="mono" style={{ fontSize: 13.5, overflowWrap: "anywhere" }}>
                  {host}
                </span>
                <span className="meter" data-tone="soft" aria-hidden="true"><i style={{ "--v": count / maxSource } as React.CSSProperties} /></span>
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
