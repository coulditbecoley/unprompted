import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import {
  CATEGORY,
  REPO_ROOT,
  latestRun,
  loadHeld,
  loadHistory,
  loadQuarantine,
  standings,
} from "@/lib/data";
import { CATEGORIES } from "@/lib/categories";
import { TrimTop } from "@/components/ui";
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
export default function AdminPage() {
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

  return (
    <section className="shell section">
      <p className="label">Operator</p>
      <h1 style={{ fontSize: "clamp(26px,4.6vw,40px)", fontWeight: 800, margin: "6px 0 12px" }}>
        Admin
      </h1>
      <p className="section-lead">
        Every change here becomes a commit on the public repository. Editing
        questions, run count or the engine list changes what the numbers mean, so
        each of those bumps the method version &mdash; and a run whose engine list
        moved without one is held rather than published.
      </p>

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
          <h3 style={{ marginTop: 6 }}>Engines ({engines.length})</h3>
          {engines.map(({ p, ready, detail }) => (
            <div className="cmp-stat" key={p.id}>
              <span>
                {p.label}{" "}
                <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                  {p.kind === "cli" ? "LOCAL" : "API"}
                </small>
              </span>
              <span className={ready ? "" : "pending"}>{detail}</span>
            </div>
          ))}

          <h3 style={{ marginTop: 18 }}>Extractors</h3>
          {extractors.map(({ p, ready, detail }) => (
            <div className="cmp-stat" key={p.id}>
              <span>
                {p.label}{" "}
                <small className="mono" style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                  {p.kind === "cli" ? "LOCAL" : "API"}
                </small>
              </span>
              <span className={ready ? "" : "pending"}>{detail}</span>
            </div>
          ))}

          <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 12 }}>
            API keys are read from the environment and never stored in the repo.
            Local harnesses are found on this machine&rsquo;s PATH, so they read
            NOT INSTALLED anywhere they are not signed in.
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
              <div className="cmp-stat">
                <span>Unrecognised names</span>
                <span>{quarantine.length}</span>
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

      {/*
        Where the week runs, and what came out of it. Split out from State
        because "is the automatic flow actually working" is a different question
        from "what is the method", and it is the one asked most often.
      */}
      <section style={{ marginBottom: 26 }}>
        <p className="label">Measurement</p>
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
