import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import { CATEGORIES, DEFAULT_CATEGORY, getCategory } from "@/lib/categories";
import { categoryLabel, REPO_ROOT, loadHistory, coverage, answered } from "@/lib/data";
import { loadProviders } from "@/lib/providers";
import { inSentence } from "@/lib/shared";
import { notFound } from "next/navigation";
import { AwaitingFirstRun, Kpi } from "@/components/ui";

type Params = { c?: string; date?: string; engine?: string; question?: string; brand?: string };

function resolve(params: Params): string {
  return params.c && getCategory(params.c) ? params.c : DEFAULT_CATEGORY;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const params = await searchParams;
  const category = resolve(params);
  const label = categoryLabel(category);
  const history = loadHistory(category, true);
  const run = params.date ? history.find(r => r.run_date === params.date) : history.at(-1);
  if (params.date && !run) notFound();
  const engine = run && coverage(run).some(c => c.engine === params.engine) ? params.engine : undefined;
  const brand = params.brand || undefined;
  if (brand && !history.some(r => answered(r).some(e => e.brands.some(b => b.name === brand)))) notFound();
  const count = run ? answered(run).filter(e => (!engine || e.engine === engine) && (!brand || e.brands.some(b => b.name === brand))).length : 0;
  const assistant = engine ? loadProviders().find(p => p.id === engine)?.label ?? engine : "all assistants";
  const title = `${brand ? `Answers naming ${brand}` : "Recorded AI answers"}: ${label}${params.question ? `: ${params.question}` : ""}`;
  const description = run
    ? `${count} answers${brand ? ` name ${brand}` : " recorded"} across the reading's questions for ${assistant}. Measured ${run.measured_on || run.run_date}; reading ${run.run_date}. Errors and refusals excluded. Inspect the evidence.`
    : `Read the questions about ${inSentence(label)}. No answers have been published yet.`;
  const url = `/questions?${new URLSearchParams({ c: category, ...(params.date && run ? { date: run.run_date } : {}), ...(engine ? { engine } : {}), ...(brand ? { brand } : {}), ...(params.question ? { question: params.question } : {}) })}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "website", siteName: "Unprompted" } };
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
  if (params.question && !spec.questions.some(q => q.id === params.question)) notFound();

  if (!run) {
    return (
      <section className="shell section q-page">
        <CategoryTabs category={category} />
        <h1 className="display page-title rise">Check the recorded answers.</h1>
        <AwaitingFirstRun />
        <a className="btn" href="/categories">Browse available results</a>
      </section>
    );
  }

  const brands = [...new Set(history.flatMap(r => answered(r).flatMap(e => e.brands.map(b => b.name))))].sort();
  const selectedBrand = params.brand || undefined;
  if (selectedBrand && !brands.includes(selectedBrand)) notFound();
  const byQuestion = new Map<string, typeof run.extractions>();
  const labels = new Map(loadProviders().map(p => [p.id, p.label]));
  const counts = coverage(run);
  const selectedEngine = counts.some(c => c.engine === params.engine) ? params.engine : undefined;
  const usable = counts.reduce((sum, c) => sum + c.answered, 0);
  const matching = (selectedBrand ? answered(run) : run.extractions).filter(e =>
    (!selectedEngine || e.engine === selectedEngine) &&
    (!selectedBrand || e.brands.some(b => b.name === selectedBrand)));
  for (const ex of matching) {
    const list = byQuestion.get(ex.question_id) ?? [];
    list.push(ex);
    byQuestion.set(ex.question_id, list);
  }

  const visibleQuestions = spec.questions.filter(q => !selectedBrand || byQuestion.has(q.id));

  return (
    <section className="shell section q-page">
      <CategoryTabs category={category} />
      <p className="label">{categoryLabel(category)} · measured {run.measured_on || run.run_date} · reading {run.run_date}</p>
      <h1 className="display page-title rise">
        Check the answers behind the chart.
      </h1>
      <p className="section-lead">
        Read the buying questions and the recorded AI answers to check where
        each brand mention came from. Each question is scheduled for
        {" "}{run.runs_per_question} attempts per assistant.
        Errors and refusals are shown but excluded
        from mention percentages.
      </p>
      <form action="/questions" className="q-reading">
        <input type="hidden" name="c" value={category} />
        <div className="q-filter">
          <label htmlFor="evidence-date">Published reading</label>
          <select className="select" id="evidence-date" name="date" defaultValue={run.run_date}>
            {history.map(r => <option key={r.run_date}>{r.run_date}</option>)}
          </select>
        </div>
        <div className="q-filter">
          <label htmlFor="evidence-engine">Assistant</label>
          <select className="select" id="evidence-engine" name="engine" defaultValue={selectedEngine ?? ""}>
            <option value="">All assistants</option>
            {counts.map(c => <option key={c.engine} value={c.engine}>{labels.get(c.engine) ?? c.engine}</option>)}
          </select>
        </div>
        <div className="q-filter">
          <label htmlFor="evidence-brand">Brand named</label>
          <select className="select" id="evidence-brand" name="brand" defaultValue={selectedBrand ?? ""}>
            <option value="">All brands</option>
            {brands.map(brand => <option key={brand}>{brand}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-go">Show answers</button>
      </form>
      {!run.methodology?.questions && <p className="cmp-note">Legacy record: question wording below comes from the current bank, not a frozen historical snapshot. Raw answers remain as recorded.</p>}
      <div className="kpi-row">
        <Kpi label="Questions in reading" value={spec.questions.length} note="The question list for this reading." />
        <Kpi i={1} label="Answers" value={usable} note={`Of ${run.extractions.length} attempts in the full reading, before filters.`} meter={usable / Math.max(run.extractions.length, 1)} />
        <Kpi i={2} label="Errors or refusals" value={run.extractions.length - usable} note="Excluded from brand mention percentages." />
      </div>
      <div className="panel q-coverage reveal">
        <h2 className="sub-h" id="coverage">Answer coverage by assistant</h2>
        <p className="cmp-note">Coverage is for the full reading. Bar length is the share of recorded attempts that produced an answer, excluding errors and refusals.</p>
        {counts.map(c => <div className="q-coverage-row" key={c.engine}>
          <span>{labels.get(c.engine) ?? c.engine}</span>
          <span className="meter" aria-hidden="true"><i style={{ "--v": c.answered / Math.max(c.attempted, 1) } as React.CSSProperties} /></span>
          <span className="mono">{c.answered}/{c.attempted}</span>
        </div>)}
      </div>
      <p className="cmp-note">
        Each line lists the brands found in one answer. Choose a question to load
        its original answers and recorded source links. Sources may be citations or
        search results; a link alone does not show which brand it supports.
      </p>

      {selectedBrand && <p className="cmp-note q-filter-result">
        {matching.length} {matching.length === 1 ? "answer names" : "answers name"} <strong>{selectedBrand}</strong> with these filters. Each answer counts once.
        {" "}<a href={`/questions?${new URLSearchParams({ c: category, date: run.run_date, ...(selectedEngine ? { engine: selectedEngine } : {}) })}`}>Show all brands</a>
      </p>}
      {selectedBrand && matching.length === 0 && <p className="panel q-empty">No answers name this brand with these filters. Try another assistant or reading, or show all brands.</p>}
      <nav className="q-jump" aria-label="Jump to a question">
        {visibleQuestions.map((q) => <a className="btn btn-sm" key={q.id} href={`#${q.id}`} title={q.text}>Q{String(spec.questions.indexOf(q) + 1).padStart(2, "0")}</a>)}
      </nav>
      {selectedEngine && <p className="cmp-note">Showing {labels.get(selectedEngine) ?? selectedEngine}. <a href={`/questions?${new URLSearchParams({ c: category, date: run.run_date, ...(selectedBrand ? { brand: selectedBrand } : {}) })}`}>Show all assistants</a></p>}
      {visibleQuestions.map((q) => {
        const rows = (byQuestion.get(q.id) ?? []);
        const engines = [...new Set(rows.map((r) => r.engine))].sort();

        return (
          <div className="q-block panel" key={q.id} id={q.id}>
            <p className="label" style={{ marginTop: 6 }}>{q.id}</p>
            <h2 className="q-text">{q.text} <SectionLink id={q.id} label={q.text} /></h2>
            {rows.length > 0 && <p className="q-load-answers">
              <a className="btn btn-sm" href={`/questions?${new URLSearchParams({
                c: category, date: run.run_date,
                ...(selectedBrand ? { brand: selectedBrand } : {}),
                ...(selectedEngine ? { engine: selectedEngine } : {}),
                ...(params.question === q.id ? {} : { question: q.id }),
              })}#${q.id}`}>
                {params.question === q.id ? "Hide full answer text" : "Read full answers to this question"}
              </a>
            </p>}
            {rows.length === 0 && <p className="cmp-note">No attempts for this question were recorded in this reading.</p>}

            {engines.map((engine) => {
              const runs = rows
                .filter((r) => r.engine === engine)
                .sort((a, b) => a.run_index - b.run_index);

              return (
                <details className="q-engine-group" key={engine} open={params.question === q.id}>
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
                        {params.question === q.id && <details className="q-answer"><summary>Read answer {r.run_index + 1} · {shortTime(r.fetched_at)}</summary>
                          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.answer || "Raw text was not recorded for this answer."}</p>
                          <p>Source evidence: {r.source_kind || "type not recorded"}</p>
                          <ul>{r.sources.filter(s => /^https?:\/\//i.test(s)).map((s, j) => <li key={j}><a href={s} target="_blank" rel="noopener noreferrer">{s}</a></li>)}</ul>
                        </details>}
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
