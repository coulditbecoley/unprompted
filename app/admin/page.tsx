import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import {
  CATEGORY,
  MAX_ENGINE_ERROR_RATE,
  REPO_ROOT,
  answered,
  costOfRun,
  engineHealth,
  latestRun,
  loadAllRuns,
  loadHeld,
  loadHistory,
  loadQuarantine,
  loadRates,
  standings,
} from "@/lib/data";
import { CATEGORIES } from "@/lib/categories";
import { TrimTop } from "@/components/ui";
import { AdminAnalytics } from "@/components/admin-analytics";
import { RunStatus } from "@/components/run-status";
import { AdminMasthead, nextRunTile, type Tile } from "@/components/admin-masthead";
import { totals } from "@/lib/analytics";
import { AdminEditor } from "@/components/admin-editor";
import { ProviderManager } from "@/components/provider-manager";
import { loadProviders, providerStatus } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * The only gated surface. Auth is enforced in proxy.ts, not here.
 *
 * Every save opens a commit against the public repository rather than writing
 * to a database, so the method's history is public by construction. That is
 * slower than an instant write and it is the entire point: "check my work" has
 * to be verifiable, not promised.
 */
const money = (n: number) =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;

export default async function AdminPage() {
  const questionsPath = path.join(REPO_ROOT, "questions", `${CATEGORY}.yml`);
  const aliasesPath = path.join(REPO_ROOT, "aliases", `${CATEGORY}.yml`);

  const questionsRaw = fs.readFileSync(questionsPath, "utf-8");
  const aliasesRaw = fs.readFileSync(aliasesPath, "utf-8");
  const spec = loadYaml(questionsRaw) as { method_version: number; runs_per_question: number };

  const history = loadHistory(CATEGORY);
  const run = latestRun(CATEGORY);
  const board = run ? standings(run) : [];

  const quarantine = loadQuarantine();

  // The engine panel reads the registry rather than a second hardcoded list,
  // so adding a provider shows up here without another edit.
  const providers = loadProviders();
  const withStatus = providers
    .filter((p) => p.enabled)
    .map((p) => ({ p, ...providerStatus(p) }));
  const engines = withStatus.filter(({ p }) => p.role === "engine");
  const extractors = withStatus.filter(({ p }) => p.role === "extractor");
  // Registry order is priority, and only one extractor ever reads a run. Which
  // one is not obvious from a list of enabled toggles, and getting it wrong is
  // expensive rather than visible, so the dashboard names it.
  const activeExtractor = extractors.find(({ p, ready }) => p.kind === "api" || ready);

  // Where the week actually runs. A local CLI engine cannot exist on a GitHub
  // runner, so registering one moves the measurement onto this machine, and the
  // dashboard should say so rather than leaving it to be inferred.
  const localEngines = engines.filter(({ p }) => p.kind === "cli");
  const held = loadHeld();

  // Every category, not just the flagship: a held or stale category is exactly
  // what an operator needs to notice, and it would be invisible here otherwise.
  const perCategory = CATEGORIES.map((c) => {
    const latest = latestRun(c.slug);
    return {
      slug: c.slug,
      label: c.label,
      date: latest?.run_date ?? null,
      methodVersion: latest?.method_version ?? null,
      extractor: latest?.extractor ?? null,
      engines: latest?.engines ?? [],
    };
  });

  // Read here rather than inside the masthead so the whole page makes one pass
  // over the store instead of two.
  const audience = await totals(30);

  /* -- the money ------------------------------------------------------------
     Priced from usage the providers themselves reported, against data/rates.json,
     by the same code the terminal uses -- tests/agreement.test.mjs prices every
     archived run through both and refuses a disagreement.

     This was computed on every run and then printed to a terminal and thrown
     away, which meant the one question a spend limit makes urgent could only be
     answered by logging into three provider dashboards. */
  const rates = loadRates();
  const { runs: allRuns, errors: archiveErrors } = loadAllRuns();

  // Priced once. Each run was previously parsed by loadAllRuns and then priced
  // three separate times -- weekly total, archive total, weekly line items --
  // over an archive that grows every Monday and is already several megabytes.
  const priced = allRuns.map((run) => ({ run, cost: costOfRun(run, rates) }));

  const lastDate = allRuns.length ? allRuns[allRuns.length - 1].run_date : null;
  const lastWeek = priced.filter((p) => p.run.run_date === lastDate);

  const weekCost = lastWeek.reduce((sum, p) => sum + p.cost.total, 0);
  const archiveCost = priced.reduce((sum, p) => sum + p.cost.total, 0);

  /*
    Answers, not attempts. This summed `extractions.length`, which counts the
    errored and refused rows too -- so the masthead said "225 answers" for a run
    the health panel beside it correctly called 201 answered and 24 failed. Two
    numbers for one thing, on one screen, and the cost-per-answer derived from
    the wrong one.
  */
  const weekAnswers = lastWeek.reduce((sum, p) => sum + answered(p.run).length, 0);

  // Per engine, across every category measured that day, so one line item is
  // one bill to reconcile rather than one file.
  const weekLines = new Map<string, { calls: number; tokens: number; dollars: number }>();
  for (const p of lastWeek) {
    for (const i of p.cost.items) {
      const at = weekLines.get(i.label) ?? { calls: 0, tokens: 0, dollars: 0 };
      at.calls += i.calls;
      at.tokens += i.inputTokens + i.outputTokens;
      at.dollars += i.dollars;
      weekLines.set(i.label, at);
    }
  }
  const costLines = [...weekLines.entries()].sort((a, b) => b[1].dollars - a[1].dollars);
  // Runs archived before usage was instrumented price at zero. Saying "$0.00"
  // about a week that certainly cost something would be a lie the page tells
  // confidently; "not recorded" is the honest reading.
  const costRecorded = weekCost > 0;

  /* -- how the engines behaved ---------------------------------------------
     The same measurement checks.py rule 5 uses to hold a week, shown
     continuously instead of only when it fires. */
  const health = engineHealth(lastWeek.map((p) => p.run));
  const worst = health[0] ?? null;

  /* -- did anybody sign up -------------------------------------------------
     Counted at the moment the form confirms, from the browser, because the
     inbox fallback never touches this server. `tried` is the click that started
     it, kept separate so an attempt that failed does not round up. */
  const clickCount = (name: string) =>
    audience.clicks.find(([label]) => label === name)?.[1] ?? 0;
  const signups = clickCount("signup:provider") + clickCount("signup:inbox");
  const signupTries = clickCount("signup:tried");

  const lastRun = (() => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "data", "last-run.json"), "utf-8"),
      ) as { status: string; at: string };
    } catch {
      return null;
    }
  })();

  /*
    Names frequent enough to have held the run they came from.

    Three thresholds were tried here and all three were wrong. The raw 549 reads
    as an emergency and is mostly a tail of things named once. An arbitrary
    "three or more" invents its own urgency. And applying the checks' real 2%
    floor -- but taking the denominator from the flagship category's latest
    published run and applying it to counts pooled from every category -- gave
    33 where the rule gives 24, because a 279-answer run's floor is six and this
    was testing against five.

    loadQuarantine decides it now, per run, because it is the only place that
    still knows which run each count came from.

    It is still a reading of the past, and the label says so. Quarantine files
    are written when a run happens, so they reflect the alias map of that
    moment; curating aliases afterwards does not rewrite them, and the count only
    falls when the next run is measured against the corrected map. Showing this
    as outstanding work would be wrong -- most of it is already fixed.
  */
  const materialQuarantine = quarantine.filter((q) => q.material).length;
  const enginesReady = engines.filter((e) => e.ready).length;

  const tiles: Tile[] = [
    {
      label: "Last run",
      value:
        lastRun?.status === "published"
          ? "clean"
          : lastRun?.status === "held"
            ? "held"
            : lastRun?.status === "failed"
              ? "failed"
              : "none yet",
      note: run ? run.run_date : "no data",
      attention: lastRun?.status === "failed" || lastRun?.status === "held",
    },
    nextRunTile(),
    {
      // Reachable is not the same as behaving. An engine can answer every probe
      // and still have failed a third of the week it was asked to measure --
      // which is exactly what happened on 2026-08-24 -- so the tile carries both.
      label: "Engines",
      value: `${enginesReady}/${engines.length}`,
      note:
        enginesReady !== engines.length
          ? "one cannot be queried"
          : worst && worst.errors > 0
            ? `${worst.engine} failed ${(worst.rate * 100).toFixed(0)}% in ${worst.worstCategory ?? "a category"}`
            : "all reachable, none failing",
      attention: enginesReady !== engines.length || Boolean(worst?.over),
    },
    {
      label: "Last run cost",
      value: costRecorded ? money(weekCost) : "not recorded",
      note: archiveErrors.length
        ? `${archiveErrors.length} file${archiveErrors.length === 1 ? "" : "s"} unreadable`
        : costRecorded
          ? `${weekAnswers} answers, ${money(weekCost / Math.max(weekAnswers, 1))} each`
          : "this run reported no usage",
      // An incomplete total presented as complete is the one thing a money tile
      // must never do.
      attention: archiveErrors.length > 0,
    },
    {
      label: "Weeks recorded",
      value: String(history.length),
      note: `method v${spec.method_version}`,
    },
    {
      label: "Read to answer",
      value: String(audience.purposes.live ?? 0),
      note: `${audience.agentHits} agent hits, 30d`,
    },
    {
      // "Signups" claimed more than it can prove. The count is a browser
      // reporting its own success through an unauthenticated endpoint: good
      // enough to answer "is anyone signing up", not good enough to be called a
      // subscriber count. It becomes authoritative when a mailing provider's
      // webhook is the thing incrementing it.
      label: "Confirmed signups",
      value: String(signups),
      note:
        signupTries > signups
          ? `${signupTries} tried, 30d`
          : signups === 0
            ? "none yet, 30d"
            : "30 days",
    },
    {
      label: "Held last run",
      value: String(materialQuarantine),
      note:
        materialQuarantine === 0
          ? "nothing material"
          : `of ${quarantine.length} names, at the map of that day`,
      // Not marked. These are a record of the last run, not a queue: alias
      // edits since then already cover most of them and the count only moves
      // when the next Monday is measured.
      attention: false,
    },
  ];

  return (
    <section className="shell section">
      <RunStatus />
      <AdminMasthead tiles={tiles} />

      {/*
        The visible h1 is gone: the most valuable space on a dashboard is its
        first screen, and this spent it on the word "Admin" at 40px over a note
        about commit behaviour, neither of which is why anybody opens the page.
        The note now lives beside the editors that do the committing.

        The heading itself stays, unstyled and off-screen. Removing it outright
        left the document starting at h2 and cost anyone navigating by headings
        the name of the page -- a visual decision should not take a structural
        one with it.
      */}
      <h1 className="sr-only">Admin dashboard</h1>
      <h2 className="zone">Operations</h2>

      <div className="cmp-grid" style={{ marginBottom: 26 }}>
        <div className="cmp-pick">
          <TrimTop />
          <h3 style={{ marginTop: 6 }}>State</h3>
          <div className="cmp-stat"><span>Method version</span><span>v{spec.method_version}</span></div>
          <div className="cmp-stat"><span>Runs per question</span><span>{spec.runs_per_question}</span></div>
          <div className="cmp-stat"><span>Weeks recorded</span><span>{history.length}</span></div>
          <div className="cmp-stat"><span>Latest run</span><span>{run?.run_date ?? "none"}</span></div>
          <div className="cmp-stat"><span>Brands charted</span><span>{board.length}</span></div>
        </div>

        <div className="cmp-pick">
          <TrimTop />
          <h3 style={{ marginTop: 6 }}>Providers</h3>

          {/*
            Status by exception. Eight rows that all said READY told an operator
            nothing they could not get from one, and buried the row that
            mattered on the day one of them stopped. Everything healthy collapses
            to a count; anything that is not gets named.
          */}
          <div className="cmp-stat">
            <span>
              Engines{" "}
              <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                {engines.length} ENABLED
              </small>
            </span>
            <span className={enginesReady === engines.length ? "" : "pending"}>
              {enginesReady === engines.length
                ? "ALL REACHABLE"
                : `${engines.length - enginesReady} UNREACHABLE`}
            </span>
          </div>

          {engines
            .filter(({ ready }) => !ready)
            .map(({ p, detail }) => (
              <div className="cmp-stat" key={p.id}>
                <span style={{ paddingLeft: 12, color: "var(--fg-2)" }}>{p.label}</span>
                <span className="pending">{detail}</span>
              </div>
            ))}

          <div className="cmp-stat">
            <span>
              Reads the week{" "}
              <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                {activeExtractor?.p.kind === "api" ? "API" : "LOCAL"}
              </small>
            </span>
            <span>{activeExtractor?.p.label ?? "NONE AVAILABLE"}</span>
          </div>

          <div className="cmp-stat">
            <span style={{ color: "var(--fg-2)" }}>Fallbacks</span>
            <span style={{ color: "var(--fg-3)" }}>
              {extractors.filter(({ p }) => p.id !== activeExtractor?.p.id).length} configured
            </span>
          </div>

          <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 12 }}>
            Only the extractor named above reads the week: the first enabled one
            this machine can reach, in registry order. The rest cost nothing
            until it is unavailable. Keys are read from the environment and never
            stored in the repo.
          </p>
        </div>

        <div className="cmp-pick">
          <TrimTop />
          <h3 style={{ marginTop: 6 }}>Quarantine</h3>
          {quarantine.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--fg-3)", margin: 0 }}>
              Empty. Nothing is waiting on you.
            </p>
          ) : (
            <>
              {/*
                The material count first. Leading with 549 made a tail of names
                seen once look like a crisis, beside the number that actually
                decides whether a Monday publishes. Both are a record of the run
                that wrote them: aliases curated since are not reflected until
                the next run is measured.
              */}
              <div className="cmp-stat">
                <span>Material at the last run</span>
                <span>{materialQuarantine}</span>
              </div>
              <div className="cmp-stat">
                <span style={{ color: "var(--fg-2)" }}>Seen at all</span>
                <span style={{ color: "var(--fg-3)" }}>{quarantine.length}</span>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--fg-3)", margin: "10px 0" }}>
                Latest run of each category, most frequent first. A name seen
                often is a brand the alias map is missing. A name seen once is
                usually a hallucination and should stay out.
              </p>

              {/* Only the names worth acting on are visible. The tail is real
                  data but it is noise, so it collapses rather than filling the
                  page above the editors. */}
              <div className="q-chips">
                {quarantine.slice(0, 6).map((q) => (
                  <span className="q-chip" key={q.name}>
                    {q.name}
                    <b>{q.count}</b>
                  </span>
                ))}
              </div>

              {quarantine.length > 6 && (
                <details className="q-more">
                  <summary>{quarantine.length - 6} more</summary>
                  <div className="q-chips" style={{ marginTop: 10 }}>
                    {quarantine.slice(6).map((q) => (
                      <span className="q-chip q-chip-dim" key={q.name}>
                        {q.name}
                        <b>{q.count}</b>
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>

      <section style={{ marginBottom: 26 }}>
        <div className="seq-board">
          <TrimTop />
          <div className="seq-row" style={{ gridTemplateColumns: "1fr auto" }}>
            <span className="seq-brand" style={{ gap: 3 }}>
              Runs on
              <small className="mono" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400 }}>
                {localEngines.length > 0
                  ? "scripts/weekly-run.cmd, Windows Task Scheduler, Mondays 13:00"
                  : ".github/workflows/weekly.yml, GitHub Actions"}
              </small>
            </span>
            <span className="mono" style={{ fontSize: 11 }}>
              {localEngines.length > 0 ? "THIS MACHINE" : "CLOUD"}
            </span>
          </div>

          {localEngines.length > 0 && (
            <div className="seq-row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="seq-brand" style={{ gap: 3 }}>
                Why not the cloud
                <small className="mono" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400 }}>
                  {localEngines.map(({ p }) => p.label).join(", ")} sign in on this
                  machine, and a run refuses to start without every declared engine
                </small>
              </span>
              <span className="mono" style={{ fontSize: 11 }}>
                {localEngines.length} LOCAL
              </span>
            </div>
          )}

          {perCategory.map((c) => (
            <div className="seq-row" key={c.slug} style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="seq-brand" style={{ gap: 3 }}>
                {c.label}
                <small className="mono" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400 }}>
                  {c.date
                    ? `${c.date} · method v${c.methodVersion} · read by ${c.extractor ?? "api"} · ${c.engines.length} engines`
                    : "no published run yet"}
                </small>
              </span>
              <span className="mono" style={{ fontSize: 11, color: c.date ? "var(--fg-2)" : "var(--fg-3)" }}>
                {c.date ? "PUBLISHED" : "NONE"}
              </span>
            </div>
          ))}

          {held.map((h) => (
            <div className="seq-row" key={`${h.date}-${h.category}`} style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="seq-brand" style={{ gap: 3 }}>
                {h.category}
                <small className="mono" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400 }}>
                  {h.date} · held, {Math.round(h.errorRate * 100)}% of calls errored ·
                  kept in data/held, never published
                </small>
              </span>
              <span className="mono seq-delta is-down" style={{ fontSize: 11 }}>
                HELD
              </span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 10 }}>
          A held run is the checks working, not a crash. Its answers are kept, so
          it can be re-read with <span className="mono">unprompted.reextract</span>{" "}
          once the cause is fixed, without paying to ask anything again.
        </p>
      </section>


      {/*
        The money, and the behaviour of the things that spent it, side by side,
        because they are one question asked twice: what did this week cost, and
        did it buy a measurement worth publishing.

        Built from the same cmp-stat rows the panels above use rather than a new
        table style. A dashboard with two ways of drawing a row of figures reads
        as two dashboards.
      */}
      <div className="cmp-grid" style={{ marginBottom: 26 }}>
        <div className="cmp-pick">
          <TrimTop />
          <h3 style={{ marginTop: 6 }}>
            Cost{" "}
            <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
              {lastDate ?? "NO RUNS"}
            </small>
          </h3>

          {!costRecorded ? (
            <p style={{ fontSize: 14, color: "var(--fg-3)", margin: 0 }}>
              This run reported no usage, so it prices at nothing. That is a
              missing measurement rather than a free week &mdash; runs archived
              before usage was instrumented carry none, and the archive is
              append-only, so they are never backfilled with a guess.
            </p>
          ) : (
            <>
              {costLines.map(([label, l]) => (
                <div className="cmp-stat" key={label}>
                  <span>
                    {label}{" "}
                    <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                      {l.calls} CALLS &middot; {(l.tokens / 1000).toFixed(0)}K TOKENS
                    </small>
                  </span>
                  <span>{money(l.dollars)}</span>
                </div>
              ))}

              <div className="cmp-stat">
                <span>
                  This run{" "}
                  <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                    {money(weekCost / Math.max(weekAnswers, 1))} PER ANSWER
                  </small>
                </span>
                <span>{money(weekCost)}</span>
              </div>

              <div className="cmp-stat">
                <span style={{ color: "var(--fg-2)" }}>
                  Every recorded run{" "}
                  <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                    AT TODAY&rsquo;S RATES
                  </small>
                </span>
                <span style={{ color: "var(--fg-3)" }}>{money(archiveCost)}</span>
              </div>

              {archiveErrors.length > 0 && (
                <p style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 12 }}>
                  {archiveErrors.length} archived file
                  {archiveErrors.length === 1 ? "" : "s"} could not be read, so
                  these totals are low by an unknown amount:{" "}
                  <span className="mono">{archiveErrors.join("; ")}</span>
                </p>
              )}

              <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 12 }}>
                Priced from usage the providers reported, against rates verified{" "}
                {rates.verified}. Every run is priced at those rates, including
                old ones, so this is what the archive would cost today rather
                than what it was billed &mdash; an accurate reading of our usage,
                not of an invoice. Reconcile against a real bill monthly.
              </p>
            </>
          )}
        </div>

        <div className="cmp-pick">
          <TrimTop />
          <h3 style={{ marginTop: 6 }}>Engine health</h3>

          {health.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--fg-3)", margin: 0 }}>No run to read.</p>
          ) : (
            <>
              {health.map((h) => (
                <div className="cmp-stat" key={h.engine}>
                  <span>
                    {h.engine}{" "}
                    <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                      {h.calls - h.errors} ANSWERED &middot; {h.errors} FAILED
                      {h.errors > 0 && h.worstCategory ? ` \u00b7 WORST IN ${h.worstCategory}` : ""}
                    </small>
                  </span>
                  <span className={h.over ? "pending" : undefined}>
                    {(h.rate * 100).toFixed(0)}%
                  </span>
                </div>
              ))}

              <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 12 }}>
                {worst?.over ? (
                  <>
                    <strong style={{ color: "var(--warn)" }}>
                      {worst.engine} was over the{" "}
                      {(MAX_ENGINE_ERROR_RATE * 100).toFixed(0)}% limit in{" "}
                      {worst.worstCategory ?? "a category"} on {lastDate}.
                    </strong>{" "}
                    A run that fails this check is meant to be held rather than
                    published, so this one is worth a decision: it stands on the
                    other engines, or it comes down.
                  </>
                ) : (
                  <>
                    A run is held rather than published when any single engine
                    fails more than {(MAX_ENGINE_ERROR_RATE * 100).toFixed(0)}% of
                    its calls in any one category. The rate above is the worst
                    category&rsquo;s, not an average across them, because an
                    average hides the breach that would hold the week.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      {/*
        Its own zone. It is the largest thing on this page and the only part an
        operator cannot get by reading the repository, so it earns the space --
        but it was previously eleven headings deep in a flat list, which made
        the operational status above it hard to find at all.
      */}
      <h2 className="zone">Audience</h2>
      <AdminAnalytics />

      {/*
        Where the week runs, and what came out of it. Split out from State
        because "is the automatic flow actually working" is a different question
        from "what is the method", and it is the one asked most often.
      */}
      <h2 className="zone">Curation</h2>
      <p className="section-lead" style={{ marginTop: -4 }}>
        Every change below becomes a commit on the public repository. Editing the
        questions, the run count or the engine list changes what the numbers
        mean, so each of those bumps the method version &mdash; and a run whose
        engine list moved without one is held rather than published.
      </p>

      <ProviderManager initial={providers} />

      <AdminEditor
        label="Questions"
        target="questions"
        initial={questionsRaw}
        note="Changing any question, or the run count, changes what every future number means. Bump method_version in the same edit."
      />

      <AdminEditor
        label="Alias map"
        target="aliases"
        initial={aliasesRaw}
        note="Adding a spelling is safe and does not change the method. Adding a brand that was previously quarantined will change future charts."
      />
    </section>
  );
}
