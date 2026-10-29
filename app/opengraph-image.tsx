import { ImageResponse } from "next/og";

import { CATEGORY, categoryLabel, latestRun, loadHistory, standings } from "@/lib/data";

export const alt = "Unprompted — what AI recommends when nobody's paying";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The social card.
 *
 * For a publication whose growth engine is somebody screenshotting a number
 * into an argument, this is a primary brand surface rather than an
 * afterthought, so it carries the live result rather than a static slogan.
 *
 * Built from the same materials as the site: graphite ground, bone type, one
 * the board's own step colour, and the mark's step rhythm. No gradients.
 */
export function boardCard(category: string, date?: string, brand?: string) {
  // A dated permalink must preview that week, not whatever leads today.
  const run = date
    ? loadHistory(category, true).find((r) => r.run_date === date) ?? null
    : latestRun(category);
  const full = run ? standings(run) : [];
  const board = full.slice(0, 5);
  const leader = board[0];
  // A brand page previews that brand: its own numbers in place of the top five.
  const rank = brand ? full.findIndex((b) => b.brand === brand) : -1;
  const focus = rank >= 0 ? full[rank] : undefined;
  const headline = focus
    ? `AI assistants name ${focus.brand} in ${Math.round(focus.rotation * 100)}% of answers.`
    : leader
      ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of answers.`
      : "What AI recommends when nobody's paying.";
  const stats: Array<[string, string]> = focus
    ? [
        ["BOARD POSITION", `#${rank + 1} of ${full.length}`],
        ["NAMED IN", `${focus.named}/${focus.totalRuns}`],
        ["NAMED FIRST", `${Math.round(focus.firstShare * 100)}%`],
      ]
    : board.map((b) => [b.brand.toUpperCase(), `${Math.round(b.firstShare * 100)}%`]);

  const GRAPHITE = "#08090A";
  const BONE = "#F7F8F8";
  const AMBER = "#9DC4E8";
  const MUTED = "#6A6F77";
  const RULE = "#1E2024";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: GRAPHITE,
          color: BONE,
          fontFamily: "sans-serif",
          padding: "56px 64px",
        }}
      >
        {/* Mark plus wordmark, same lockup as the site header. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 40 }}>
            <div style={{ width: 11, height: 40, background: BONE }} />
            <div style={{ width: 11, height: 22, background: BONE }} />
            <div style={{ width: 11, height: 31, background: AMBER }} />
            <div style={{ width: 11, height: 13, background: BONE }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.035em" }}>
            Unprompted
          </div>
        </div>

        {/* The live verdict, at display scale. */}
        <div
          style={{
            display: "flex",
            fontSize: focus ? 74 : leader ? 86 : 66,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.02,
            marginTop: 44,
            maxWidth: 1000,
          }}
        >
          {headline}
        </div>

        <div style={{ display: "flex", flex: 1 }} />

        {/* The board, abbreviated. Real numbers, never a mock-up. */}
        {stats.length > 0 && (
          <div style={{ display: "flex", gap: 40, marginBottom: 28 }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 15,
                    color: MUTED,
                    letterSpacing: "0.1em",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 6 }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `1px solid ${RULE}`,
            paddingTop: 20,
            fontSize: 19,
            color: MUTED,
          }}
        >
          <div style={{ display: "flex" }}>
            {run ? `${categoryLabel(category)} · measured ${run.measured_on || run.run_date}` : categoryLabel(category)}
          </div>
          <div style={{ display: "flex" }}>unprompted.report</div>
        </div>
      </div>
    ),
    size,
  );
}

export default function OpenGraphImage() {
  return boardCard(CATEGORY);
}
