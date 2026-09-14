import { cadence, daily, feed, type Totals } from "@/lib/analytics";

const sum = (rows: Array<[string, number]>) => rows.reduce((n, [, value]) => n + value, 0);
const event = (t: Totals, prefix: string) => sum(t.clicks.filter(([key]) => key.startsWith(prefix)));
const contentViews = (t: Totals) => sum(t.views.filter(([key]) => /^\/(chart|brand|questions|methodology|compare|consensus)(\/|$)/.test(key)));

export async function AdminAnalytics({ current, previous }: { current: Totals; previous: Totals }) {
  if (current.status !== "ok") return <p role="status" className="section-lead">
    {current.status === "unconfigured" ? "Audience collection is not configured." : "Audience data is unavailable. Retry later; unavailable does not mean zero visits."}
  </p>;
  const [entries, days, seen] = await Promise.all([feed(20), daily(14), cadence()]);
  const metrics = [
    ["Browser page views", current.humanHits, previous.humanHits],
    ["Content page views", contentViews(current), contentViews(previous)],
    ["Comparison views", sum(current.comparisons), sum(previous.comparisons)],
    ["External referrals", sum(current.referrers), sum(previous.referrers)],
    ["Assistant referrals", sum(current.fromAssistants), sum(previous.fromAssistants)],
    ["Signup completions reported by browsers", event(current, "signup:provider") + event(current, "signup:inbox"), event(previous, "signup:provider") + event(previous, "signup:inbox")],
    ["Contact completions reported by browsers", event(current, "contact:sent"), event(previous, "contact:sent")],
  ] as const;
  return <>
    <h3>Weekly audience scorecard</h3>
    <p className="section-lead">Seven complete UTC days compared with the preceding seven. Counts describe recorded activity, not distinct people, retention or verified subscribers. This browser is excluded after opening admin.</p>
    <div className="table-scroll"><table className="audience-table">
      <caption>Audience activity by week</caption>
      <thead><tr><th scope="col">Signal</th><th scope="col">Last 7 days</th><th scope="col">Previous 7</th><th scope="col">Change</th></tr></thead>
      <tbody>{metrics.map(([label, now, before]) => <tr key={label}><th scope="row">{label}</th><td>{now}</td><td>{previous.status === "ok" ? before : "Unavailable"}</td><td>{previous.status !== "ok" ? "Unavailable" : `${now - before > 0 ? "+" : ""}${now - before}`}</td></tr>)}</tbody>
    </table></div>
    <p className="cmp-note">Collection changes take effect prospectively. Existing counts may include testing and repeated referrals. Missing referrers mean unknown origin, not necessarily direct visits. Subscriber verification requires reconciliation with the mailing provider.</p>
    <div className="an-grid">
      <section><h3>Content people opened</h3><Rows rows={current.views} empty="No browser views recorded in this window." /></section>
      <section><h3>External referrals</h3><Rows rows={current.referrers} empty="No external referrer recorded." /></section>
      <section><h3>Brand page views</h3><Rows rows={current.brands} empty="No brand page views recorded." /></section>
      <section><h3>Comparison views</h3><Rows rows={current.comparisons} empty="No comparison views recorded." /></section>
    </div>
    <details className="analytics-details"><summary>Daily activity and collection diagnostics</summary>
      <p>Daily counts include today, which is incomplete. Empty counters cannot distinguish no traffic from lost capture. Recent events demonstrate successful writes only at the displayed times.</p>
      <Rows rows={days.map(d => [d.date, d.human])} empty="Daily data unavailable." />
      <h3>Recent recorded events</h3>
      <ul>{entries.map((e, i) => <li key={`${e.at}-${i}`} className="mono">{new Date(e.at).toISOString()} ? {e.agent ?? (e.missing ? "unclassified request" : "browser event")} ? {e.event ?? e.path}{e.missing ? " (unrecognized path)" : ""}</li>)}</ul>
    </details>
    <details className="analytics-details"><summary>Crawler and automated-request diagnostics</summary>
      <p>Last seven complete days. User agents are self-declared. A request proves neither that content was used in training nor that an assistant cited it. Missing paths may be scanners, broken links or mistakes.</p>
      <Rows rows={current.agents} empty="No declared automation recorded." />
      <h3>Requested paths</h3><Rows rows={current.agentPaths.map(([pair, n]) => [pair.replace("\u0000", " ? "), n])} empty="No automated requests recorded." />
      <h3>Unrecognized paths</h3><Rows rows={current.missing} empty="No unrecognized paths recorded." />
      <h3>First and last recorded request</h3><p>Lifetime timestamps; these do not measure return frequency.</p>
      <ul>{seen.map(s => <li key={s.agent}>{s.agent}: {new Date(s.first).toISOString()} ? {new Date(s.last).toISOString()}</li>)}</ul>
    </details>
    <p className="cmp-note">No visitor identifier or IP address is stored in audience counters. The browser exclusion flag is a local preference, not a tracking identifier. Daily counters expire after 90 days.</p>
  </>;
}

function Rows({ rows, empty }: { rows: Array<[string, number]>; empty: string }) {
  if (!rows.length) return <p className="cmp-note">{empty}</p>;
  return <dl className="audience-rows">{rows.slice(0, 14).map(([label, n]) => <div key={label}><dt>{label}</dt><dd>{n}</dd></div>)}</dl>;
}
