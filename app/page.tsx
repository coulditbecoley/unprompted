import type { Metadata } from "next";
import Link from "next/link";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import {
  answeredPerQuestion,
  CATEGORY,
  categoryLabel,
  comparisonReason,
  REPO_ROOT,
  latestRun,
  loadHistory,
  loadQuestionText,
  movement,
  questionOrder,
  standings,
  topPickByEngine,
  theSnub,
} from "@/lib/data";
import { LiveBoard } from "@/components/board-live";
import { Freshness, ShareRow } from "@/components/freshness";
import { Subscribe } from "@/components/subscribe";
import { CATEGORIES } from "@/lib/categories";
import { inSentence } from "@/lib/shared";
import { loadProviders } from "@/lib/providers";
import { AwaitingFirstRun, HowToRead, Insights, Kpi, LeaderBars, StatusBar, TopPicks, brandHref } from "@/components/ui";

type QuestionSpec = {
  questions: { id: string; text: string }[];
  runs_per_question: number;
  method_version: number;
};

function questionSpec(): QuestionSpec {
  const file = path.join(REPO_ROOT, "questions", `${CATEGORY}.yml`);
  return loadYaml(fs.readFileSync(file, "utf-8")) as QuestionSpec;
}

/** The verdict travels with the link: search results and previews show it. */
export function generateMetadata(): Metadata {
  const run = latestRun(CATEGORY);
  const top = run ? standings(run)[0] : undefined;
  if (!run || !top) return { alternates: { canonical: "/" } };
  const description = `Which brands do AI assistants recommend when nobody pays? In the latest reading, measured ${run.measured_on || run.run_date}, ${top.brand} was named first in ${Math.round(top.firstShare * 100)}% of answers about ${inSentence(categoryLabel(CATEGORY))}. Every question and answer is public.`;
  return {
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: "Unprompted", title: "Unprompted — what AI recommends when nobody's paying", description },
  };
}

export default function Home() {
  const spec = questionSpec();
  const run = latestRun(CATEGORY);
  const history = loadHistory(CATEGORY);
  const measured = run?.measured_on || run?.run_date;
  const questions = run?.methodology?.questions?.questions ?? spec.questions;

  const board = run ? standings(run) : [];
  const picks = run ? topPickByEngine(run) : [];
  const older = history.at(-2);
  const comparisonNote = run ? comparisonReason(run, older) : null;
  const baselineDate = older?.measured_on || older?.run_date;
  const moves = older && comparisonNote === null ? movement(board, standings(older)) : [];
  const moveFor = new Map(moves.map((m) => [m.brand, m]));
  const snub = theSnub(moves);
  const leader = board[0];

  // The board's steps are indexed by question order, so the text has to be put
  // in the same order to be able to name the column a reader is pointing at.
  const text = loadQuestionText(CATEGORY, run);
  const questionsInBoardOrder = run
    ? questionOrder(run).map((id) => text[id] ?? id)
    : [];

  // Engine ids are internal. A newcomer knows the assistants by name.
  const engineLabels = new Map(loadProviders().map((p) => [p.id, p.label]));
  const engineNames = (run?.engines ?? []).map((e) => engineLabels.get(e) ?? e);
  const runsPerQ = run?.runs_per_question ?? spec.runs_per_question;
  const answered = run ? answeredPerQuestion(run).reduce((a, b) => a + b, 0) : 0;
  const otherBoards = CATEGORIES.filter((c) => c.slug !== CATEGORY)
    .map((c) => ({ c, r: latestRun(c.slug) }))
    .filter((x) => x.r)
    .map(({ c, r }) => ({ c, top: standings(r!)[0], date: r!.measured_on || r!.run_date }))
    .filter((x) => x.top);

  // Plain answers to what a first-time visitor asks before believing a chart.
  // Facts only from METHODOLOGY.md and the data; nothing promotional.
  const faq: Array<[string, string]> = run
    ? [
        [
          "Can a brand pay to appear or rank higher?",
          "No. Unprompted is run by Skald Studio, which sells AI visibility work, and says so on every page. No company has any say in the questions, the method or the results, no placement is for sale, and no charted company is a Skald Studio client.",
        ],
        [
          "Does being named first mean a product is the best?",
          "No. It records what the assistants said, not what is good. A brand named first in 30% of answers is simply the one these assistants put first in about three of every ten answers.",
        ],
        [
          `Why ask every question ${runsPerQ} times?`,
          `AI assistants rarely give the same answer twice. One answer is a coin flip, so each question is asked ${runsPerQ} times per assistant and the page reports how often a brand came up.`,
        ],
        [
          "Is this what I would see in the ChatGPT or Gemini app?",
          "Not exactly. We ask each provider's API, with its own web search where it has one. The consumer apps add their own instructions, personalisation and shopping features, which an API does not reproduce.",
        ],
        [
          "Can I check the numbers myself?",
          "Yes. Every question, every recorded answer, the code and the full history are public. Each board links to the answers behind it.",
        ],
      ]
    : [];

  return (
    <>
      <section className="hero">
        <div className="hero-bg" aria-hidden="true" />
        <div className="shell hero-grid">
          <div>
            <p className="eyebrow rise">
              <span className="live-dot" aria-hidden="true" />
              {categoryLabel(CATEGORY)} · {measured ? `measured ${measured}` : "not yet measured"}
            </p>

            {/* Answer-first: the verdict is the first thing on the page, before
                any explanation, because that is what gets read and cited. */}
            <h1 className="display rise" style={{ "--i": 1 } as React.CSSProperties}>
              {leader ? (
                <>
                  AI names{" "}
                  <span className="verdict-brand">{leader.brand}</span> first in{" "}
                  <span className="verdict-num">{Math.round(leader.firstShare * 100)}%</span> of answers.
                </>
              ) : (
                <>What AI recommends when nobody&rsquo;s paying.</>
              )}
            </h1>

            <p className="hero-sub rise" style={{ "--i": 2 } as React.CSSProperties}>
              When someone asks an AI assistant &ldquo;what should I buy?&rdquo;, which
              brands does it recommend? Every week we ask{" "}
              {engineNames.length ? engineNames.join(", ") : "the major assistants"} the
              same {questions.length} buying questions, {runsPerQ} times each, and
              count who they name. Nobody can pay to appear, and every answer is public.
            </p>

            <div className="btn-row rise" style={{ marginTop: 22, "--i": 3 } as React.CSSProperties}>
              <Link className="btn btn-go" href={`/chart/${CATEGORY}`}>
                See the full board <span className="arr" aria-hidden="true">→</span>
              </Link>
              <a className="btn" href="#how">How it works</a>
              <Link className="btn btn-ghost" href="/categories">All categories</Link>
            </div>
          </div>

          {/* The query buffer: the actual questions, visible on the page. */}
          <div className="buffer rise" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="buffer-head">
              <span className="buffer-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="label">The questions we ask</span>
              <span className="label">{questions.length} × {runsPerQ}</span>
            </div>
            <div className="buffer-body" aria-label="The questions being asked">
              {questions.slice(0, 9).map((q, i) => (
                <div className="buffer-line" data-wide={i >= 4 || undefined} key={q.id} style={{ "--i": i } as React.CSSProperties}>
                  <span className="buffer-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="buffer-q">
                    {run ? (
                      <Link href={`/questions?${new URLSearchParams({ c: CATEGORY, date: run.run_date, question: q.id })}#${q.id}`}>
                        ask(&ldquo;{q.text}&rdquo;)
                      </Link>
                    ) : (
                      <>ask(&ldquo;{q.text}&rdquo;)</>
                    )}
                  </span>
                </div>
              ))}
              {/* Phones show four questions, wider screens nine; each gets its own
                  closing line so the "more" count is true at either width. */}
              {[4, 9].map((shown) => (
                <div className="buffer-line" data-more={shown} key={shown} style={{ "--i": shown } as React.CSSProperties}>
                  <span className="buffer-n">
                    {String(Math.min(shown + 1, questions.length)).padStart(2, "0")}
                  </span>
                  <span className="buffer-q">
                    <Link href="/questions">…{Math.max(0, questions.length - shown)} more</Link>
                    <span className="caret" aria-hidden="true" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {run && (
          <div className="shell"><div className="kpi-row">
            <Kpi i={0} label="Questions" value={questions.length} note="Real buying questions, worded the way people ask them." />
            <Kpi i={1} label="Answers read" value={answered.toLocaleString("en-US")} note={`Each question asked ${runsPerQ} times per assistant.`} />
            <Kpi i={2} label="Brands named" value={board.length} note="Every product any assistant recommended." />
            <Kpi i={3} label="AI assistants" value={engineNames.length} note={engineNames.join(" · ")} />
          </div></div>
        )}
      </section>

      <section className="shell section" id="board" style={{ paddingTop: 24 }}>
        {run ? (
          <>
            <div className="sec-head">
              <div>
                <p className="label">The board</p>
                <h2>Who the assistants recommend</h2>
              </div>
              <Link className="btn btn-sm" href={`/chart/${CATEGORY}`}>
                Open full board <span className="arr" aria-hidden="true">→</span>
              </Link>
            </div>
            <StatusBar
              runDate={run.run_date}
              engines={engineNames}
              methodVersion={run.method_version}
              runsPerQuestion={run.runs_per_question}
            />
            <Freshness runDate={measured!} />
            {!run.methodology?.questions && <p className="cmp-note">Older reading: question wording comes from the current question list, because the wording used at the time was not saved.</p>}
            <p className="cmp-note">{comparisonNote ?? <>Change is measured against <Link href={`/chart/${CATEGORY}/${older!.run_date}`}>{baselineDate}</Link>.</>}</p>
            <Insights board={board} />
            <HowToRead runsPerQuestion={run.runs_per_question} />
            <LiveBoard
              questions={questionsInBoardOrder}
              denominators={answeredPerQuestion(run)}
              rows={board.map((b, i) => ({
                standing: { ...b, cells: [] },
                rank: i + 1,
                move: moveFor.get(b.brand),
                href: brandHref(CATEGORY, b.brand),
              }))}
            />

            <ShareRow
              url={`https://unprompted.report/chart/${CATEGORY}/${run.run_date}`}
              headline={
                leader
                  ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of answers about ${inSentence(categoryLabel(CATEGORY))}.`
                  : "What AI recommends when nobody's paying."
              }
            />

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

            {board.length > 1 && (
              <div className="reveal" style={{ marginTop: 52 }}>
                <p className="label">At a glance</p>
                <h2 style={{ margin: "4px 0 6px" }}>Mentioned often is not the same as recommended first</h2>
                <p className="section-lead" style={{ marginBottom: 16 }}>
                  The pale bar is how often a brand came up at all. The solid bar is how
                  often it was the first pick. When the two differ, the assistants know the
                  brand but reach for something else first.
                </p>
                <LeaderBars rows={board.slice(0, 6)} hrefFor={(b) => brandHref(CATEGORY, b)} />
              </div>
            )}

            {picks.length > 1 && (
              <div className="reveal" style={{ marginTop: 52 }}>
                <p className="label">Assistant by assistant</p>
                <h2 style={{ margin: "4px 0 6px" }}>Each assistant&rsquo;s favourite</h2>
                <TopPicks picks={picks} labels={engineLabels} hrefFor={(b) => brandHref(CATEGORY, b)} />
              </div>
            )}
          </>
        ) : (
          <AwaitingFirstRun />
        )}
      </section>

      <section className="shell section reveal" id="how" style={{ paddingTop: 0 }}>
        <p className="label">How it works</p>
        <h2 style={{ margin: "4px 0 18px" }}>Three steps, every Monday</h2>
        <ol className="steps">
          <li className="step card-lift">
            <span className="step-n mono">01</span>
            <h3>Ask</h3>
            <p>
              We put the same {questions.length} buying questions to each assistant,
              worded like a real person would. No brand names in the question.
            </p>
          </li>
          <li className="step card-lift">
            <span className="step-n mono">02</span>
            <h3>Repeat</h3>
            <p>
              AI rarely gives the same answer twice, so each question is asked{" "}
              {runsPerQ} times. One answer is a coin flip; {runsPerQ} is a pattern.
            </p>
          </li>
          <li className="step card-lift">
            <span className="step-n mono">03</span>
            <h3>Count</h3>
            <p>
              We record every brand named and which came first, then publish the
              totals with the raw answers so anyone can check them.
            </p>
          </li>
        </ol>
        <div className="btn-row" style={{ marginTop: 18 }}>
          <Link className="btn" href="/methodology">
            Read the full method <span className="arr" aria-hidden="true">→</span>
          </Link>
          <Link className="btn btn-ghost" href="/questions">See every answer</Link>
        </div>
      </section>

      {otherBoards.length > 0 && (
        <section className="shell section reveal" style={{ paddingTop: 0 }}>
          <div className="sec-head">
            <div>
              <p className="label">Other boards</p>
              <h2>Measured the same way</h2>
            </div>
            <Link className="btn btn-sm btn-ghost" href="/categories">
              All categories <span className="arr" aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="ob-grid">
            {otherBoards.map(({ c, top, date }) => (
              <Link key={c.slug} href={`/chart/${c.slug}`} className="ob-card card-lift">
                <span className="label">{c.label}</span>
                <span className="ob-lead">{top.brand}</span>
                <span className="ob-note">
                  named first in {Math.round(top.firstShare * 100)}% of answers
                </span>
                <span className="meter" aria-hidden="true">
                  <i style={{ "--v": top.firstShare } as React.CSSProperties} />
                </span>
                <span className="mono ob-date">{date}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {faq.length > 0 && (
        <section className="shell section reveal" id="faq" style={{ paddingTop: 0 }}>
          <p className="label">Common questions</p>
          <h2 style={{ margin: "4px 0 18px" }}>Before you trust a number here</h2>
          {/* Same words for readers and for search engines, from one list. */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
              }).replace(/</g, "\\u003c"),
            }}
          />
          <div className="faq">
            {faq.map(([q, a]) => (
              <details key={q} className="faq-item">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <section className="shell">
        <Subscribe />
      </section>
    </>
  );
}
