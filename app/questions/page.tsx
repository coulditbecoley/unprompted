import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import { CATEGORY, categoryLabel, REPO_ROOT, latestRun } from "@/lib/data";
import { AwaitingFirstRun, TrimTop } from "@/components/ui";

export const metadata: Metadata = {
  title: "Every question, every answer",
  description:
    "The exact questions asked, and which brands each AI assistant named for each one. Show your work.",
};

type Spec = { questions: { id: string; text: string }[] };

/**
 * The show-your-work surface. Every figure on the chart traces back to here,
 * and from here to the raw JSON in the repository. Credibility rests on this
 * page existing, so it is deliberately plain and complete rather than pretty.
 */
export default function QuestionsPage() {
  const spec = loadYaml(
    fs.readFileSync(path.join(REPO_ROOT, "questions", `${CATEGORY}.yml`), "utf-8"),
  ) as Spec;

  const run = latestRun(CATEGORY);

  if (!run) {
    return (
      <section className="shell">
        <AwaitingFirstRun />
      </section>
    );
  }

  const byQuestion = new Map<string, typeof run.extractions>();
  for (const ex of run.extractions) {
    const list = byQuestion.get(ex.question_id) ?? [];
    list.push(ex);
    byQuestion.set(ex.question_id, list);
  }

  return (
    <section className="shell section">
      <p className="label">{categoryLabel(CATEGORY)} · week of {run.run_date}</p>
      <h1 style={{ fontSize: "clamp(26px,4.6vw,40px)", fontWeight: 800, margin: "6px 0 12px" }}>
        Every question, and what each assistant answered.
      </h1>
      <p className="section-lead">
        {spec.questions.length} questions, asked {run.runs_per_question} times of
        each engine. Below is which brands each engine named, per run, in order.
        The raw answers behind all of it are in the repository.
      </p>

      {spec.questions.map((q) => {
        const rows = byQuestion.get(q.id) ?? [];
        const engines = [...new Set(rows.map((r) => r.engine))].sort();

        return (
          <div className="q-block" key={q.id}>
            <TrimTop />
            <p className="label" style={{ marginTop: 6 }}>{q.id}</p>
            <p className="q-text">{q.text}</p>

            {engines.map((engine) => {
              const runs = rows
                .filter((r) => r.engine === engine)
                .sort((a, b) => a.run_index - b.run_index);

              return (
                <div className="q-eng" key={engine}>
                  <span className="label">{engine}</span>
                  <span className="q-names">
                    {runs.map((r, i) => (
                      <span key={i} style={{ display: "block" }}>
                        {r.error ? (
                          <em>error: {r.error.slice(0, 80)}</em>
                        ) : r.refused ? (
                          <em>declined to recommend</em>
                        ) : r.brands.length ? (
                          r.brands.map((b) => b.name).join(" · ")
                        ) : (
                          <em>named nothing</em>
                        )}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
