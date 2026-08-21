import type { Metadata } from "next";
import {
  CATEGORY,
  CATEGORY_LABEL,
  latestRun,
  loadHistory,
  movement,
  sourceCounts,
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

export const metadata: Metadata = {
  title: "The board",
  description:
    "This week's standings: which brands AI assistants named, how often, and what moved.",
};

export default function ChartPage() {
  const run = latestRun(CATEGORY);
  const history = loadHistory(CATEGORY);

  if (!run) {
    return (
      <section className="shell">
        <AwaitingFirstRun />
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

  return (
    <section className="shell section">
      <p className="label">{CATEGORY_LABEL}</p>
      <h1 style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, margin: "6px 0 10px" }}>
        {leader
          ? `${leader.brand} leads, named first in ${Math.round(leader.firstShare * 100)}% of runs.`
          : "No brand was named this week."}
      </h1>
      <p className="section-lead">
        Week of {run.run_date}. Each cell is one run. A filled cell means the brand
        was named in that run.
      </p>

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
                <span className="mono" style={{ fontSize: 14 }}>{host}</span>
                <span className="mono" style={{ fontSize: 13, color: "var(--fg-2)" }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
