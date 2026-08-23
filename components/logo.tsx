/**
 * The Unprompted mark.
 *
 * The mark is the product's own signature object: a velocity step row, the
 * same one that carries every brand on the board. Four steps, uneven heights,
 * and exactly one of them carrying the board's full-intensity colour.
 *
 * Two decisions carry the meaning:
 *
 * 1. The rhythm is deliberately irregular. An ascending bar chart is the
 *    generic "data product" mark; this one refuses that shape, because the
 *    thing being measured is not a trend, it is a pattern.
 *
 * 2. The coloured step is NOT the tallest. That encodes the finding the whole
 *    publication exists to surface: being mentioned most and being recommended
 *    first are different things. TAG is named in a third of answers and named
 *    first more often than Beckett, which is named in 84%. The mark says that.
 *
 * Drawn as bare geometry with no frame, no rounding and no gradient, because
 * the world it lives in has hard 1px rules and flat surfaces.
 */

const STEPS = [
  { height: 1.0, accent: false },
  { height: 0.55, accent: false },
  { height: 0.78, accent: true },
  { height: 0.32, accent: false },
];

const COLS = 4;
const GAP = 2;
const BOX = 32;
const BAR_W = (BOX - GAP * (COLS - 1)) / COLS; // 6.5

export function Mark({
  size = 20,
  title,
}: {
  size?: number;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      {STEPS.map((step, i) => {
        const h = Math.round(step.height * BOX * 100) / 100;
        return (
          <rect
            key={i}
            x={i * (BAR_W + GAP)}
            y={BOX - h}
            width={BAR_W}
            height={h}
            fill={step.accent ? "var(--cell-4)" : "currentColor"}
          />
        );
      })}
    </svg>
  );
}

/**
 * The full lockup: mark plus wordmark. The wordmark is the site's own display
 * face at its heaviest weight, so the logo is not a separate typographic world
 * bolted onto the page.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="logo-lockup">
      <Mark size={size} />
      <span className="logo-word">Unprompted</span>
    </span>
  );
}
