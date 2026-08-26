"use client";

import { useState } from "react";

import { SequencerRow, TrimTop } from "@/components/ui";
import type { BrandStanding, Movement } from "@/lib/data";

/**
 * The board, with its steps made answerable.
 *
 * Every step on this board is one question, and until now that was true and
 * invisible: 270 squares that a sighted reader could not interrogate, while the
 * row's aria-label carried the counts for everyone else. Hovering a step now
 * names the question and reads out who leads it, and dims the other columns so
 * a single question can be read down the whole board.
 *
 * That is a dimension no competing tool publishes — not "who wins overall" but
 * "who wins *this* question" — and it was already in the data. DESIGN.md asks
 * that anything which is not a number earn its place by making a number easier
 * to read. This makes 270 of them readable.
 *
 * No colour is spent. The active column stays as it was and the rest recede,
 * so the effect survives greyscale and costs nothing from the ration that keeps
 * green, red and blue meaningful.
 */

export type BoardRow = {
  standing: BrandStanding;
  rank: number;
  move?: Movement;
  href?: string;
};

type SortKey = "first" | "named" | "move";

/**
 * Comparators, not a generic sort: three columns is not enough to earn an
 * abstraction, and each of these reads as the sentence a reader would say.
 */
const SORTS: Record<SortKey, (a: BoardRow, b: BoardRow) => number> = {
  first: (a, b) =>
    b.standing.firstShare - a.standing.firstShare ||
    b.standing.rotation - a.standing.rotation,
  named: (a, b) =>
    b.standing.named - a.standing.named ||
    b.standing.firstShare - a.standing.firstShare,
  // A brand with no previous week sorts last rather than as zero: "new" is not
  // "did not move", and putting the two together would invent a flat week.
  move: (a, b) =>
    (b.move && !b.move.isNew ? b.move.rotationDelta : -Infinity) -
      (a.move && !a.move.isNew ? a.move.rotationDelta : -Infinity) ||
    b.standing.firstShare - a.standing.firstShare,
};

function SortHead({
  className,
  label,
  hint,
  k,
  sort,
  onSort,
}: {
  className: string;
  label: string;
  hint: string;
  k: SortKey;
  sort: SortKey;
  onSort: (k: SortKey) => void;
}) {
  const on = sort === k;
  return (
    <button
      type="button"
      className={`label seq-sort ${className}`}
      data-on={on}
      aria-pressed={on}
      title={hint}
      onClick={() => onSort(k)}
    >
      {label}
    </button>
  );
}

export function LiveBoard({
  rows,
  questions,
  denominators,
}: {
  rows: BoardRow[];
  /** Question text in board order, aligned to every standing's `steps`. */
  questions: string[];
  /**
   * How many runs of each question answered, in the same order.
   *
   * Passed rather than derived. Dividing the answered total by the number of
   * questions gives an average, and the readout published it as a count: the
   * image board showed "13/13" for questions where fifteen runs had answered.
   */
  denominators: number[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [sort, setSort] = useState<SortKey>("first");

  const steps = rows[0]?.standing.steps.length ?? 0;

  // The rank column keeps the first-named ordering whatever the sort, because
  // the gap between the two orderings is the finding. Cursor is named in more
  // runs than anything else and is third on first mentions; the mark at the top
  // of every page is four steps where the tallest is not the coloured one, for
  // exactly this reason. Re-ranking on sort would hide it.
  const sorted = [...rows].sort(SORTS[sort]);

  const lead =
    active === null
      ? null
      : rows.reduce<BoardRow | null>((best, row) => {
          const v = row.standing.stepNamed[active] ?? 0;
          if (!best || v > (best.standing.stepNamed[active] ?? 0))
            return v > 0 ? row : best;
          return best;
        }, null);

  return (
    // The readout sits above the board and sticks, because the board is taller
    // than a viewport: below it, hovering a top row put the answer off screen,
    // which is the one place it needed to be. Sticky inside this wrapper rather
    // than the page, so it leaves with the board instead of following the
    // reader down into the next section.
    <div className="board-wrap" onMouseLeave={() => setActive(null)}>
      <div className="board-read" data-on={active !== null}>
        {active === null ? (
          <span className="board-read-idle">
            {steps} questions · hover a step to read one down the board
          </span>
        ) : (
          <>
            <span className="mono board-read-q">
              Q{String(active + 1).padStart(2, "0")}
            </span>
            <span className="board-read-text">{questions[active] ?? "—"}</span>
            <span className="mono board-read-lead">
              {lead ? (
                <>
                  {lead.standing.brand}{" "}
                  <i>
                    {lead.standing.stepNamed[active] ?? 0}/
                    {denominators[active] ?? 0}
                  </i>
                </>
              ) : (
                <i>nobody named</i>
              )}
            </span>
          </>
        )}
      </div>

      <div className="seq-board">
        <TrimTop />
        <div className="seq-row seq-head">
          <span className="label seq-rank" aria-hidden="true">
            #
          </span>
          <span className="label seq-brand">Brand</span>
          <span className="label seq-cells" aria-hidden="true">
            By question
          </span>
          <SortHead
            className="seq-rot"
            label="Named"
            hint="Sort by how many runs named this brand at all"
            k="named"
            sort={sort}
            onSort={setSort}
          />
          <SortHead
            className="seq-first"
            label="First"
            hint="Sort by how often this brand was named first"
            k="first"
            sort={sort}
            onSort={setSort}
          />
          <SortHead
            className="seq-delta"
            label="Δ"
            hint="Sort by movement since last week"
            k="move"
            sort={sort}
            onSort={setSort}
          />
        </div>
        {sorted.map((row) => (
          <SequencerRow
            key={row.standing.brand}
            standing={row.standing}
            rank={row.rank}
            move={row.move}
            href={row.href}
            activeStep={active}
            onStep={setActive}
          />
        ))}
      </div>
    </div>
  );
}
