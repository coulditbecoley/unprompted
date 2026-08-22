import { ImageResponse } from "next/og";

import { CATEGORY, CATEGORY_LABEL, latestRun, standings } from "@/lib/data";

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
 * amber, and the mark's own step rhythm. No gradients, no rounding.
 */
export default function OpenGraphImage() {
  const run = latestRun(CATEGORY);
  const board = run ? standings(run).slice(0, 5) : [];
  const leader = board[0];

  const GRAPHITE = "#121417";
  const BONE = "#F5F4F0";
  const AMBER = "#E8913C";
  const MUTED = "#878D95";
  const RULE = "#2B2F35";

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
            fontSize: leader ? 86 : 66,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.02,
            marginTop: 44,
            maxWidth: 1000,
          }}
        >
          {leader
            ? `AI names ${leader.brand} first in ${Math.round(leader.firstShare * 100)}% of runs.`
            : "What AI recommends when nobody's paying."}
        </div>

        <div style={{ display: "flex", flex: 1 }} />

        {/* The board, abbreviated. Real numbers, never a mock-up. */}
        {board.length > 0 && (
          <div style={{ display: "flex", gap: 40, marginBottom: 28 }}>
            {board.map((b) => (
              <div key={b.brand} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 15,
                    color: MUTED,
                    letterSpacing: "0.1em",
                  }}
                >
                  {b.brand.toUpperCase()}
                </div>
                <div
                  style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 6 }}
                >
                  {`${Math.round(b.firstShare * 100)}%`}
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
            {run ? `${CATEGORY_LABEL} · week of ${run.run_date}` : CATEGORY_LABEL}
          </div>
          <div style={{ display: "flex" }}>unprompted.report</div>
        </div>
      </div>
    ),
    size,
  );
}
