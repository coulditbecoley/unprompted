import { CATEGORIES } from "@/lib/categories";
import { TrimTop } from "@/components/ui";

type Status = {
  status: string;
  runDate: string | null;
  at: string | null;
  detail: string;
  categories: Record<string, unknown>;
};

const WORD: Record<string, string> = {
  published: "recorded (legacy status)",
  measured: "measured; deployment not verified",
  held: "held for review",
  failed: "did not finish",
  unknown: "has not reported yet",
};

const OUTCOME: Record<string, string> = {
  passed: "Passed", held: "Held", failed: "Failed",
  not_started: "Not started", not_run: "Not run",
};

const recordedNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** The committed report only; local attempts and deployment are not observable here. */
export function RunStatus({ last }: { last: Status | null }) {
  return (
    <section aria-labelledby="latest-run-heading">
      <h2 className="zone" id="latest-run-heading">Latest run</h2>
      {!last ? <p>The committed run status is missing or unreadable.</p> : <>
        <p>
          <strong>{last.runDate ?? "Run date not recorded"}</strong>
          {" · "}{Object.hasOwn(WORD, last.status) ? WORD[last.status] : "Unknown status"}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--fg-3)" }}>
          Report recorded: {last.at
            ? <time dateTime={last.at}>{new Date(last.at).toISOString().replace("T", " ").replace(".000Z", " UTC")}</time>
            : "not recorded"}. Committed report only; deployment and later local attempts are not verified.
        </p>
        {Object.keys(last.categories).length === 0 ? <>
          <p>Per-category results were not recorded.</p>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{last.detail || "No details recorded."}</p>
        </> : <div className="cmp-grid">
          {Object.entries(last.categories).map(([slug, value]) => {
            const row = value && typeof value === "object" && !Array.isArray(value)
              ? value as Record<string, unknown> : {};
            const reasons = Array.isArray(row.reasons)
              ? row.reasons.filter((reason): reason is string => typeof reason === "string" && Boolean(reason.trim())) : [];
            return <article className="cmp-pick" key={slug} style={{ overflowWrap: "anywhere" }}>
              <TrimTop />
              <h3>{CATEGORIES.find(c => c.slug === slug)?.label ?? slug}</h3>
              <div className="cmp-stat"><span>Outcome</span><span>{typeof row.outcome === "string" && Object.hasOwn(OUTCOME, row.outcome) ? OUTCOME[row.outcome] : "Not recorded"}</span></div>
              <div className="cmp-stat"><span>Minutes</span><span>{recordedNumber(row.minutes) ? row.minutes.toFixed(1) : "not recorded"}</span></div>
              <div className="cmp-stat"><span>Cost</span><span>{recordedNumber(row.dollars) ? `$${row.dollars.toFixed(2)}` : "not recorded"}</span></div>
              {reasons.length ? <ul>{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p>No reasons recorded.</p>}
            </article>;
          })}
        </div>}
      </>}
    </section>
  );
}
