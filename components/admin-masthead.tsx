import { nextRun } from "@/lib/schedule";

/**
 * The six figures that answer "is this healthy, and what happened".
 *
 * A dashboard's most valuable space is its first screen, and this one spent it
 * on the word "Admin" set at 40px followed by a paragraph about commit
 * behaviour. Neither is a thing an operator opens the page to find out. A
 * trading desk puts the numbers there and the documentation somewhere else.
 *
 * Chosen so that a glance answers three questions in order of how often they
 * are asked: did the last run work, is the next one coming, and is anything
 * waiting for me. Everything below this is detail for when one of them reads
 * wrong.
 *
 * Status by exception. A tile is marked only when it needs attention -- amber
 * for a thing that wants a decision, nothing at all for a thing that is fine --
 * because a board where everything is coloured is a board where colour has
 * stopped meaning anything.
 */

export type Tile = {
  label: string;
  value: string;
  /** The smaller line under the figure. */
  note?: string;
  /** Draws attention. Reserved for "a person needs to do something". */
  attention?: boolean;
};

function relative(target: Date, now: Date): string {
  const hours = Math.round((target.getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return "due now";
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function AdminMasthead({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="mast">
      {tiles.map((t) => (
        <div className="mast-tile" key={t.label} data-attention={t.attention ?? false}>
          <span className="label mast-label">{t.label}</span>
          <span className="mono mast-value">{t.value}</span>
          {t.note && <span className="mast-note">{t.note}</span>}
        </div>
      ))}
    </div>
  );
}

/** The schedule tile, computed on the server so it needs no client component. */
export function nextRunTile(): Tile {
  const now = new Date();
  const next = nextRun(now);
  return {
    label: "Next run",
    value: relative(next, now),
    note: next.toLocaleString("en-GB", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}
