import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import {
  CATEGORY,
  CATEGORY_LABEL,
  REPO_ROOT,
  latestRun,
  loadHistory,
  movement,
  standings,
  theSnub,
} from "@/lib/data";
import {
  AwaitingFirstRun,
  SequencerHead,
  SequencerRow,
  StatusBar,
  TrimTop,
  brandHref,
} from "@/components/ui";

type QuestionSpec = {
  questions: { id: string; text: string }[];
  runs_per_question: number;
  method_version: number;
};

function questionSpec(): QuestionSpec {
  const file = path.join(REPO_ROOT, "questions", `${CATEGORY}.yml`);
  return loadYaml(fs.readFileSync(file, "utf-8")) as QuestionSpec;
}

export default function Home() {
  const spec = questionSpec();
  const run = latestRun(CATEGORY);
  const history = loadHistory(CATEGORY);

  const board = run ? standings(run) : [];
  const prev = history.length > 1 ? standings(history[history.length - 2]) : [];
  const moves = board.length ? movement(board, prev) : [];
  const moveFor = new Map(moves.map((m) => [m.brand, m]));
  const snub = theSnub(moves);
  const leader = board[0];

  return (
    <>
      <section className="hero shell">
        <div className="hero-grid">
          <div>
            <p className="label" style={{ marginBottom: 18 }}>
              {CATEGORY_LABEL} · {run ? run.run_date : "not yet measured"}
            </p>

            {/* Answer-first: the verdict is the first thing on the page, before
                any explanation, because that is what gets read and cited. */}
            <h1 className="display">
              {leader ? (
                <>
                  AI names{" "}
                  <span className="verdict-brand">{leader.brand}</span> first in{" "}
                  {Math.round(leader.firstShare * 100)}% of runs.
                </>
              ) : (
                <>What AI recommends when nobody&rsquo;s paying.</>
              )}
            </h1>

            <p className="hero-sub">
              Every week we ask the AI assistants the same {spec.questions.length}{" "}
              buying questions, {spec.runs_per_question} times each, and publish
              exactly who they name. The questions, the method and every raw answer
              are public.
            </p>

            <p className="mono" style={{ fontSize: 12.5 }}>
              <Link href="/chart">See the full board →</Link>
            </p>
          </div>

          {/* The query buffer: the actual questions, visible on the page. */}
          <div className="buffer">
            <TrimTop />
            <div className="buffer-body" aria-label="The questions being asked">
              {spec.questions.slice(0, 9).map((q, i) => (
                <div className="buffer-line" key={q.id}>
                  <span className="buffer-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="buffer-q">ask(&ldquo;{q.text}&rdquo;)</span>
                </div>
              ))}
              <div className="buffer-line">
                <span className="buffer-n">
                  {String(Math.min(10, spec.questions.length)).padStart(2, "0")}
                </span>
                <span className="buffer-q">
                  …{spec.questions.length - 9} more
                  <span className="caret" aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="shell section">
        {run ? (
          <>
            <StatusBar
              runDate={run.run_date}
              engines={run.engines}
              methodVersion={run.method_version}
              runsPerQuestion={run.runs_per_question}
            />
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
          </>
        ) : (
          <AwaitingFirstRun />
        )}
      </section>

      <section className="shell section">
        <h2>Why we ask five times</h2>
        <p className="section-lead">
          These systems do not give the same answer twice. Ask the same question on
          Monday and Wednesday and you can get different brands. Asking once and
          publishing the result would be publishing a coin flip, so we ask
          repeatedly and report how <em>often</em> a brand was named. Each cell on
          the board above is one run.
        </p>
        <p className="mono" style={{ fontSize: 12.5 }}>
          <Link href="/methodology">Read the full method →</Link>
        </p>
      </section>
    </>
  );
}
