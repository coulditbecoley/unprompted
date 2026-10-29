import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import { categoryLabel, REPO_ROOT, loadHistory, coverage } from "@/lib/data";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";
import { notFound } from "next/navigation";
import { AwaitingFirstRun, Kpi } from "@/components/ui";

type Params = { c?: string; date?: string; engine?: string };

function resolve(params: Params): string {
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
    title: `Every question, every answer: ${label}`,
    openGraph: { title: `Recorded AI answers: ${label}`, description: "Read the questions, brand mentions, and source evidence behind the chart." },
    description:
      `The exact questions asked about ${inSentence(label)}, and which brands ` +
      "each AI assistant named for each one. Show your work.",
  };
}

type Spec = { questions: { id: string; text: string }[] };

/**
 * The category picker.
 *
 * This page carried one category while the site published three, so the
 * evidence behind two thirds of the chart existed only as JSON in the
 * repository — and llms.txt pointed machines here as "every question and
 * answer". A trust surface that covers a third of the publication is worse
 * than one that admits what it covers.
 */
function CategoryTabs({ category }: { category: string }) {
  return (
    <nav className="cat-tabs" aria-label="Category">
      {CATEGORIES.map((c) => (
        <a
          key={c.slug}
          href={`/questions?c=${c.slug}`}
          className="cat-tab"
          aria-current={c.slug === category ? "page" : undefined}
        >
          {c.label}
        </a>
      ))}
    </nav>
  );
}

/**
 * The show-your-work surface. Every figure on the chart traces back to here,
 * and from here to the raw JSON in the repository. Credibility rests on this
 * page existing, so it is deliberately plain and complete rather than pretty.
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const category = resolve(params);
  let spec = loadYaml(
    fs.readFileSync(path.join(REPO_ROOT, "questions", `${category}.yml`), "utf-8"),
  ) as Spec;

  const history = loadHistory(category, true);
  const run = params.date ? history.find(r => r.run_date === params.date) : history.at(-1);
  if (params.date && !run) notFound();
  if (run?.methodology?.questions) spec = run.methodology.questions;

  if (!run) {
    return (
      <section className="shell section">
        <CategoryTabs category={category} />
        <h1 className="display page-title rise">Check the recorded answers.</h1>
        <AwaitingFirstRun />
        <a className="btn" href="/categories">Browse available results</a>
      </section>
    );
  }

  const byQuestion = new Map<string, typeof run.extractions>();
  const labels = new Map(loadProviders().map(p => [p.id, p.label]));
  const counts = coverage(run);
  const selectedEngine = counts.some(c => c.engine === params.engine) ? params.engine : undefined;
  const usable = counts.reduce((sum, c) => sum + c.answered, 0);
  for (const ex of run.extractions) {
    const list = byQuestion.get(ex.question_id) ?? [];
    list.push(ex);
    byQuestion.set(ex.question_id, list);
  }

  return (
    <section className="shell section">
      <CategoryTabs category={category} />
      <p className="label">{categoryLabel(category)} · measured {run.measured_on || run.run_date} · reading {run.run_date}</p>
      <h1 className="display page-title rise">
        Check the answers behind the chart.
      </h1>
      <p className="section-lead">
        Read the buying questions and the recorded AI answers to check where
        each brand mention came from. Each question is scheduled for
        {" "}{run.runs_per_question} attempts per engine (an AI assistant).
        Each attempt is one run; errors and refusals are shown but excluded
        from mention percentages.
      </p>
      <form action="/questions" className="btn-row q-reading"><input type="hidden" name="c" value={category} /><label htmlFor="evidence-date">Published reading </label><select className="select" id="evidence-date" name="date" defaultValue={run.run_date}>{history.map(r => <option key={r.run_date}>{r.run_date}</option>)}</select> <label htmlFor="evidence-engine">Assistant</label><select className="select" id="evidence-engine" name="engine" defaultValue={selectedEngine ?? ""}><option value="">All assistants</option>{counts.map(c => <option key={c.engine} value={c.engine}>{labels.get(c.engine) ?? c.engine}</option>)}</select><button type="submit" className="btn btn-go">Show answers</button></form>
      {!run.methodology?.questions && <p className="cmp-note">Legacy record: question wording below comes from the current bank, not a frozen historical snapshot. Raw answers remain as recorded.</p>}
      <div className="kpi-row">
        <Kpi label="Questions listed" value={spec.questions.length} note="The question list for this reading." />
        <Kpi i={1} label="Usable answers" value={usable} note={`Of ${run.extractions.length} recorded attempts.`} meter={usable / Math.max(run.extractions.length, 1)} />
        <Kpi i={2} label="Errors or refusals" value={run.extractions.length - usable} note="Excluded from brand mention percentages." />
      </div>
      <div className="panel q-coverage reveal">
        <h2 className="sub-h" id="coverage">Answer coverage by assistant</h2>
        <p className="cmp-note">Coverage is for the full reading. Bar length is the share of recorded attempts that produced a usable answer.</p>
        {counts.map(c => <div className="q-coverage-row" key={c.engine}>
          <span>{labels.get(c.engine) ?? c.engine}</span>
          <span className="meter" aria-hidden="true"><i style={{ "--v": c.answered / Math.max(c.attempted, 1) } as React.CSSProperties} /></span>
          <span className="mono">{c.answered}/{c.attempted}</span>
        </div>)}
      </div>
      <p className="cmp-note">
        Each line lists the brands found in one answer. Open it to read the
        original text and recorded source links. Sources may be citations or
        search results; a link alone does not show which brand it supports.
      </p>

      <nav className="q-jump" aria-label="Jump to a question">
        {spec.questions.map((q, i) => <a className="btn btn-sm" key={q.id} href={`#${q.id}`} title={q.text}>Q{String(i + 1).padStart(2, "0")}</a>)}
      </nav>
      {selectedEngine && <p className="cmp-note">Showing {labels.get(selectedEngine) ?? selectedEngine}. <a href={`/questions?c=${category}&date=${run.run_date}`}>Show all assistants</a></p>}
      {spec.questions.map((q) => {
        const rows = (byQuestion.get(q.id) ?? []).filter(r => !selectedEngine || r.engine === selectedEngine);
        const engines = [...new Set(rows.map((r) => r.engine))].sort();

        return (
          <div className="q-block panel" key={q.id} id={q.id}>
            <p className="label" style={{ marginTop: 6 }}>{q.id}</p>
            <h2 className="q-text">{q.text} <SectionLink id={q.id} label={q.text} /></h2>
            {rows.length === 0 && <p className="cmp-note">No attempts for this question were recorded in this reading.</p>}

            {engines.map((engine) => {
              const runs = rows
                .filter((r) => r.engine === engine)
                .sort((a, b) => a.run_index - b.run_index);

              return (
                <details className="q-engine-group" key={engine}>
                  <summary>{labels.get(engine) ?? engine} <span className="mono">{runs.length} recorded answers</span></summary>
                  <div className="q-names">
                    {runs.map((r, i) => (
                      <div key={i} className="q-attempt">
                        {r.error ? (
                          <em>Could not use this answer: {r.error.slice(0, 80)}</em>
                        ) : r.refused ? (
                          <em>Declined to recommend a brand</em>
                        ) : r.brands.length ? (
                          r.brands.map((b) => b.name).join(" · ")
                        ) : (
                          <em>No recognized brand found</em>
                        )}
                        <details className="q-answer"><summary>Read answer {r.run_index + 1} · {shortTime(r.fetched_at)}</summary>
                          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.answer || "Raw text was not recorded for this answer."}</p>
                          <p>Source evidence: {r.source_kind || "type not recorded"}</p>
                          <ul>{r.sources.filter(s => /^https?:\/\//i.test(s)).map((s, j) => <li key={j}><a href={s} target="_blank" rel="noopener noreferrer">{s}</a></li>)}</ul>
                        </details>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

function shortTime(value?: string): string {
  if (!value) return "time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time not recorded";
  return `${date.toISOString().slice(11, 16)} UTC`;
}
