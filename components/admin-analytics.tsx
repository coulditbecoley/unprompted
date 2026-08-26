import {
  analyticsEnabled,
  cadence,
  daily,
  feed,
  PAIR_SEP,
  totals,
} from "@/lib/analytics";
import { TrimTop } from "@/components/ui";

/**
 * Who read this, and on whose behalf.
 *
 * The ordering is the argument. Agent traffic comes first and human traffic
 * second, which is the opposite of every analytics dashboard, because it is the
 * opposite of what is interesting here. A publication about what assistants
 * recommend has a natural second question — which assistants are reading it —
 * and no hosted analytics product can answer it, because agents never run the
 * script those products depend on.
 *
 * Within agents, "answering someone" comes before "training". A single
 * ChatGPT-User hit means a person asked a question and this page was read to
 * answer them. A thousand GPTBot hits mean a crawler passed through. Those are
 * different facts and a combined "bot traffic" number would destroy both.
 */

// Everything Redis still holds. It expires a day after ninety, so a shorter
// window here would hide archived-but-live data for no reason. Anything older
// than that lives in the Obsidian vault: scripts/sync_analytics.py copies each
// day out before it ages away, and the index there carries all-time totals.
const WINDOW_DAYS = 90;

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

function ago(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export async function AdminAnalytics() {
  if (!analyticsEnabled()) {
    return (
      <>
        <p className="label" style={{ marginTop: 44 }}>
          Audience
        </p>
        <h2 style={{ fontSize: 22, margin: "6px 0 6px" }}>Nothing is being counted</h2>
        <p className="section-lead">
          Capture needs <code>KV_REST_API_URL</code> and <code>KV_REST_API_TOKEN</code>,
          which the Upstash integration provisions. Until they are set the site
          records nothing at all, which is the correct failure: a dashboard that
          invented numbers would be worse than an empty one.
        </p>
      </>
    );
  }

  const [t, entries, days, seen] = await Promise.all([
    totals(WINDOW_DAYS),
    feed(40),
    daily(14),
    cadence(),
  ]);

  /*
    Signups and contact submissions ride the same event channel as clicks, and
    the masthead already counts them. Left in here they would be the same number
    in two places, which is how a dashboard starts disagreeing with itself.
  */
  const clicks = t.clicks.filter(
    ([label]) => !label.startsWith("signup:") && !label.startsWith("contact:"),
  );

  const live = t.purposes.live ?? 0;
  const cited = t.fromAssistants.reduce((sum, [, n]) => sum + n, 0);
  const peak = Math.max(1, ...days.map((d) => d.human + d.agent));

  return (
    <>
      <p className="section-lead" style={{ marginTop: -4 }}>
        Last {WINDOW_DAYS} days, which is everything the cache holds; the
        Obsidian vault keeps the rest. Agents are counted from the request itself,
        which is the only place they appear: they do not run the script that
        counts humans. A user agent is self-declared and can be forged, so read
        these as what the client said it was, not as proof.
      </p>

      {/* -- the shape of a fortnight ------------------------------------- */}
      {days.some((d) => d.human + d.agent > 0) && (
        <>
          <p className="label an-cap">Fourteen days</p>
          <div className="an-spark" role="img" aria-label="Daily hits, humans and agents">
            {days.map((d) => (
              <span className="an-day" key={d.date} title={`${d.date}: ${d.human} human, ${d.agent} agent`}>
                <i className="an-bar an-bar-agent" style={{ height: `${(d.agent / peak) * 100}%` }} />
                <i className="an-bar an-bar-human" style={{ height: `${(d.human / peak) * 100}%` }} />
                <em>{d.date.slice(8)}</em>
              </span>
            ))}
          </div>
          <p className="cmp-note">
            Two bars a day: agents on the left, humans on the right.
          </p>
        </>
      )}

      {/* -- agents -------------------------------------------------------- */}
      <h3 className="an-group">Assistants</h3>
      <p className="label an-cap">Which ones</p>
      {t.agents.length === 0 ? (
        <Empty what="No agent has identified itself yet." />
      ) : (
        <div className="seq-board">
          <TrimTop />
          <div className="seq-row an-head">
            <span className="label">Agent</span>
            <span className="label">Vendor</span>
            <span className="label">Why</span>
            <span className="label an-num">Hits</span>
            <span className="label an-num">Share</span>
          </div>
          {t.agents.slice(0, 18).map(([name, count]) => {
            const meta = AGENT_META[name];
            return (
              <div className="seq-row an-row" key={name}>
                <span className="mono an-name">{name}</span>
                <span className="an-dim">{meta?.vendor ?? "—"}</span>
                <span className="an-why" data-purpose={meta?.purpose ?? "training"}>
                  {PURPOSE_WORD[meta?.purpose ?? "training"]}
                </span>
                <span className="mono an-num">{count}</span>
                <span className="mono an-num an-dim">{pct(count, t.agentHits)}</span>
              </div>
            );
          })}
        </div>
      )}

      {t.agentPaths.length > 0 && (
        <>
          <p className="label an-cap">What they read</p>
          <div className="seq-board">
            <TrimTop />
            {t.agentPaths.slice(0, 14).map(([pair, count]) => {
              const [name, path] = pair.split(PAIR_SEP);
              return (
                <div className="seq-row an-row2" key={pair}>
                  <span className="mono an-name">{name}</span>
                  <span className="mono an-dim an-path">{path ?? "\u2014"}</span>
                  <span className="mono an-num">{count}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* -- cadence: a different question from volume --------------------- */}
      {seen.length > 0 && (
        <>
          <p className="label an-cap">
            How often they return
            <small> first and last seen, ever</small>
          </p>
          <div className="seq-board">
            <TrimTop />
            {seen.slice(0, 14).map((row) => (
              <div className="seq-row an-row2" key={row.agent}>
                <span className="mono an-name">{row.agent}</span>
                <span className="an-dim an-path">
                  first seen {ago(row.first)}
                </span>
                <span className="mono an-num">{ago(row.last)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* -- people --------------------------------------------------------- */}
      <h3 className="an-group">People</h3>
      <div className="an-grid">
        <div>
          <p className="label an-cap">Brands looked up</p>
          {t.brands.length === 0 && t.brandsByAgents.length === 0 ? (
            <Empty what="No brand page read yet." />
          ) : (
            <>
              <TwoCol rows={t.brands.slice(0, 12)} />
              {t.brandsByAgents.length > 0 && (
                <p className="cmp-note">
                  People only. Assistants read brand pages{" "}
                  {t.brandsByAgents.reduce((n, [, v]) => n + v, 0)} time(s) over
                  the same window, most often{" "}
                  {t.brandsByAgents[0]?.[0].replace(/ \(.*\)$/, "")}. Counted
                  apart, because a crawler sweeping every page and a person
                  choosing one are not the same interest.
                </p>
              )}
            </>
          )}
        </div>
        <div>
          <p className="label an-cap">Compared against each other</p>
          {t.comparisons.length === 0 ? (
            <Empty what="No comparison made yet." />
          ) : (
            <TwoCol rows={t.comparisons.slice(0, 12)} />
          )}
        </div>
      </div>
      <p className="cmp-note">
        Which brands a reader put side by side is revealed intent about who
        competes with whom, and nobody else publishes it. Pairs are normalised,
        so Cursor against Copilot and Copilot against Cursor are one row: which
        side a reader typed first is not a fact about the brands.
      </p>

      <p className="label an-cap">Pages read</p>
      {t.views.length === 0 ? (
        <Empty what="No human page view recorded yet." />
      ) : (
        <TwoCol rows={t.views.slice(0, 14)} total={t.humanHits} />
      )}

      <div className="an-grid">
        <div>
          <p className="label an-cap">Clicks</p>
          {clicks.length === 0 ? (
            <Empty what="No click recorded yet." />
          ) : (
            <TwoCol rows={clicks.slice(0, 12)} />
          )}
        </div>
        <div>
          <p className="label an-cap">Came from</p>
          {t.referrers.length === 0 ? (
            <Empty what="Every visit so far was direct." />
          ) : (
            <TwoCol rows={t.referrers.slice(0, 12)} />
          )}
        </div>
      </div>

      {/* The mirror of agent traffic, and the better half of it. */}
      {t.fromAssistants.length > 0 && (
        <>
          <p className="label an-cap">Arrived from an assistant</p>
          <p className="cmp-note">
            A person asked an assistant something, it answered with this site,
            and they clicked through. Agent hits say the chart was read; these
            say it was passed on to somebody.
          </p>
          <TwoCol rows={t.fromAssistants.slice(0, 10)} />
        </>
      )}

      {t.missing.length > 0 && (
        <>
          <p className="label an-cap">Asked for, and not here</p>
          <p className="cmp-note">
            Paths that resolved to nothing. From a person this is a typo; from an
            agent it is what it expected this site to have.
          </p>
          <TwoCol rows={t.missing.slice(0, 10)} />
        </>
      )}

      {/* -- the live feed -------------------------------------------------- */}
      <h3 className="an-group">Latest</h3>
      {entries.length === 0 ? (
        <Empty what="Nothing yet." />
      ) : (
        <div className="seq-board">
          <TrimTop />
          {entries.map((e, i) => (
            <div className="seq-row an-feed" key={`${e.at}-${i}`}>
              <span className="mono an-dim an-when">{ago(e.at)}</span>
              <span className="an-who" data-agent={Boolean(e.agent)}>
                {e.agent ? (
                  <>
                    <span className="mono">{e.agent}</span>
                    {e.purpose === "live" && <i className="an-live">answering</i>}
                  </>
                ) : (
                  <span className="an-dim">reader</span>
                )}
              </span>
              <span className="mono an-path">
                {e.event ?? e.path}
                {e.missing && <i className="an-miss"> not here</i>}
              </span>
              <span className="mono an-dim an-ref">{e.referrer ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      <p className="cmp-note" style={{ marginTop: 14 }}>
        No cookie is set, no identifier is minted and no address is stored. A
        referrer is reduced to a hostname before it is written. Counters expire
        after ninety days on their own.
      </p>
    </>
  );
}

/* -- pieces ---------------------------------------------------------------- */

const PURPOSE_WORD: Record<string, string> = {
  live: "answering someone",
  training: "training / indexing",
  search: "search crawl",
};

// Kept beside the dashboard rather than looked up from lib/agents, so a name
// stored before a vendor was known still renders instead of disappearing.
const AGENT_META: Record<string, { vendor: string; purpose: string }> = Object.fromEntries(
  (
    [
      ["ChatGPT-User", "OpenAI", "live"],
      ["OAI-SearchBot", "OpenAI", "search"],
      ["GPTBot", "OpenAI", "training"],
      ["Claude-User", "Anthropic", "live"],
      ["Claude-SearchBot", "Anthropic", "search"],
      ["ClaudeBot", "Anthropic", "training"],
      ["anthropic-ai", "Anthropic", "training"],
      ["Perplexity-User", "Perplexity", "live"],
      ["PerplexityBot", "Perplexity", "search"],
      ["Google-Extended", "Google", "training"],
      ["GoogleOther", "Google", "training"],
      ["Googlebot", "Google", "search"],
      ["BingPreview", "Microsoft", "search"],
      ["bingbot", "Microsoft", "search"],
      ["DuckAssistBot", "DuckDuckGo", "live"],
      ["MistralAI-User", "Mistral", "live"],
      ["YouBot", "You.com", "search"],
      ["Applebot-Extended", "Apple", "training"],
      ["Applebot", "Apple", "search"],
      ["meta-externalagent", "Meta", "training"],
      ["FacebookBot", "Meta", "training"],
      ["Amazonbot", "Amazon", "search"],
      ["Bytespider", "ByteDance", "training"],
      ["CCBot", "Common Crawl", "training"],
      ["cohere-ai", "Cohere", "training"],
      ["Diffbot", "Diffbot", "training"],
      ["ImagesiftBot", "Imagesift", "training"],
      ["Timpibot", "Timpi", "training"],
      ["Omgilibot", "Webz.io", "training"],
      ["DataForSeoBot", "DataForSEO", "search"],
      ["SemrushBot", "Semrush", "search"],
      ["AhrefsBot", "Ahrefs", "search"],
      ["other automation", "unknown", "training"],
      ["(no user agent)", "unknown", "training"],
    ] as const
  ).map(([name, vendor, purpose]) => [name, { vendor, purpose }]),
);

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="cns-stat">
      <TrimTop />
      <span className="mono cns-stat-v">{value}</span>
      <span className="cns-stat-l">{label}</span>
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return (
    <p className="mono" style={{ fontSize: 12.5, color: "var(--fg-3)", margin: "8px 0 0" }}>
      {what}
    </p>
  );
}

function TwoCol({ rows, total }: { rows: Array<[string, number]>; total?: number }) {
  const top = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="seq-board">
      <TrimTop />
      {rows.map(([name, count]) => (
        <div className="seq-row an-row2" key={name}>
          <span className="mono an-path">{name}</span>
          <span className="an-track" aria-hidden="true">
            <i style={{ width: `${(count / top) * 100}%` }} />
          </span>
          <span className="mono an-num">
            {count}
            {total ? <em className="an-dim"> {pct(count, total)}</em> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
