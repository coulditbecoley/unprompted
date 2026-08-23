import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import { CATEGORY, REPO_ROOT, latestRun, loadHistory, loadQuarantine, standings } from "@/lib/data";
import { TrimTop } from "@/components/ui";
import { AdminEditor } from "@/components/admin-editor";
import { ProviderManager } from "@/components/provider-manager";
import { loadProviders, providerStatus } from "@/lib/providers";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * The only gated surface. Auth is enforced in middleware, not here.
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
  const engines = providers.map((p) => ({ p, ...providerStatus(p) }));

  return (
    <section className="shell section">
      <p className="label">Operator</p>
      <h1 style={{ fontSize: "clamp(26px,4.6vw,40px)", fontWeight: 800, margin: "6px 0 12px" }}>
        Admin
      </h1>
      <p className="section-lead">
        Every change here becomes a commit on the public repository. Editing
        questions, run count or the engine list changes what the numbers mean, so
        each of those bumps the method version.
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
          <h3 style={{ marginTop: 6 }}>Providers</h3>
          {engines.map(({ p, ready, detail }) => (
            <div className="cmp-stat" key={p.id}>
              <span>{p.label}</span>
              <span className={ready ? "" : "pending"}>{detail}</span>
            </div>
          ))}
          <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 12 }}>
            Keys are read from the environment. They are never stored in the repo.
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
