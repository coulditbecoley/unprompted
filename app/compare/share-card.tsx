import { ImageResponse } from "next/og";

/** Owned-page previews use boardCard's lockup without changing the shared route. */
export function shareCard({ label, headline, detail, stats, footer }: {
  label: string;
  headline: string;
  detail: string;
  stats: Array<[string, string]>;
  footer: string;
}) {
  const bone = "#F7F8F8";
  const muted = "#A0A5AC";
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#08090A", color: bone, fontFamily: "sans-serif", padding: "48px 64px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 40 }}>
          {[40, 22, 31, 13].map((height, i) => <div key={i} style={{ width: 11, height, background: i === 2 ? "#9DC4E8" : bone }} />)}
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.035em" }}>Unprompted</div>
      </div>
      <div style={{ display: "flex", fontSize: 18, color: muted, marginTop: 32 }}>{label}</div>
      <div style={{ display: "flex", fontSize: headline.length > 55 ? 58 : 70, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.05, marginTop: 12 }}>{headline}</div>
      <div style={{ display: "flex", fontSize: 24, color: muted, marginTop: 16 }}>{detail}</div>
      <div style={{ display: "flex", flex: 1 }} />
      {stats.length > 0 && <div style={{ display: "flex", gap: 32, marginTop: 24, marginBottom: 28 }}>
        {stats.map(([name, value], i) => <div key={i} style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", fontSize: 17, color: muted }}>{name}</div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, marginTop: 8 }}>{value}</div>
        </div>)}
      </div>}
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #1E2024", paddingTop: 20, fontSize: 17, color: muted }}>
        <div style={{ display: "flex", maxWidth: 770 }}>{footer}</div>
        <div style={{ display: "flex" }}>unprompted.report</div>
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
}
