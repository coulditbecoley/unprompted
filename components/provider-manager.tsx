"use client";

import { useState } from "react";

import type { Provider } from "@/lib/providers";

type Detected = {
  id: string;
  label: string;
  command: string;
  args?: string[];
  version?: string;
};

/**
 * Add, disable and detect providers.
 *
 * Saving commits providers.json to the public repository, same as every other
 * method change, so "which machine answered this week" is part of the record
 * rather than a local setting nobody can audit.
 *
 * Detection only finds anything when this dashboard is running on the machine
 * that owns the CLIs. Hosted, the scan says so instead of failing, because a
 * serverless function genuinely cannot see a laptop and pretending otherwise
 * would be a confusing bug rather than an honest limit.
 */
export function ProviderManager({ initial }: { initial: Provider[] }) {
  const [providers, setProviders] = useState<Provider[]>(initial);
  const [scan, setScan] = useState<{ note: string; detected: Detected[] } | null>(null);
  const [busy, setBusy] = useState<"idle" | "scanning" | "saving">("idle");
  const [message, setMessage] = useState("");

  const [draft, setDraft] = useState({
    label: "",
    kind: "cli" as "api" | "cli",
    role: "extractor" as "engine" | "extractor",
    command: "",
    args: "",
    env: "",
  });

  const dirty = JSON.stringify(providers) !== JSON.stringify(initial);

  async function detect() {
    setBusy("scanning");
    setMessage("");
    try {
      const res = await fetch("/api/admin/providers/detect");
      const data = await res.json();
      setScan(data);
    } catch {
      setMessage("Scan failed. Is the dashboard still running?");
    } finally {
      setBusy("idle");
    }
  }

  function add(p: Provider) {
    if (providers.some((x) => x.id === p.id)) {
      setMessage(`${p.label} is already in the list.`);
      return;
    }
    setProviders([...providers, p]);
    setMessage("");
  }

  function addManual() {
    const id = slug(draft.label);
    if (!id) {
      setMessage("Give the provider a name.");
      return;
    }
    if (draft.kind === "cli" && !/^[A-Za-z0-9._-]{1,64}$/.test(draft.command)) {
      setMessage("Command must be a plain executable name, no paths or symbols.");
      return;
    }
    if (draft.kind === "api" && !draft.env.trim()) {
      setMessage("An API provider needs the name of its key variable.");
      return;
    }

    add({
      id,
      label: draft.label.trim(),
      kind: draft.kind,
      role: draft.role,
      enabled: true,
      ...(draft.kind === "cli"
        ? {
            command: draft.command.trim(),
            args: draft.args.split(/\s+/).filter(Boolean),
          }
        : { env: draft.env.trim() }),
    });
    setDraft({ ...draft, label: "", command: "", args: "", env: "" });
  }

  function toggle(id: string) {
    setProviders(
      providers.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    );
  }

  async function save() {
    setBusy("saving");
    setMessage("");
    const content = JSON.stringify(
      {
        _comment:
          "Provider registry. Edited from /admin, committed to this public repo like any method change. The web app never executes `command`; only the local Python pipeline does.",
        providers,
      },
      null,
      2,
    );
    try {
      const res = await fetch("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "providers", content }),
      });
      const data = await res.json();
      setMessage(res.ok ? "Committed. Redeploy to pick it up." : data.error ?? "Save failed.");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy("idle");
    }
  }

  return (
    <section style={{ marginBottom: 34 }}>
      <div className="ed-head">
        <p className="label">Providers</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={detect} disabled={busy !== "idle"}>
            {busy === "scanning" ? "Scanning…" : "Scan this machine"}
          </button>
          <button className="btn btn-go" onClick={save} disabled={!dirty || busy !== "idle"}>
            {busy === "saving" ? "Saving…" : "Commit"}
          </button>
        </div>
      </div>

      <div className="seq-board">
        <span className="trim-top" aria-hidden="true" />
        {providers.map((p) => (
          <div className="seq-row" key={p.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
            <span className="seq-brand" style={{ gap: 3 }}>
              {p.label}
              <small className="mono" style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 400 }}>
                {p.kind === "cli" ? `${p.command} ${(p.args ?? []).join(" ")}` : p.env} · {p.role}
              </small>
            </span>
            <span className="mono" style={{ fontSize: 11, color: p.enabled ? "var(--fg-2)" : "var(--fg-3)" }}>
              {p.kind === "cli" ? "LOCAL CLI" : "API"}
            </span>
            <button className="btn" onClick={() => toggle(p.id)} style={{ fontSize: 11 }}>
              {p.enabled ? "ON" : "OFF"}
            </button>
          </div>
        ))}
      </div>

      {scan && (
        <div className="panel" style={{ padding: "14px 16px", marginTop: 12 }}>
          <p style={{ fontSize: 13.5, color: "var(--fg-2)", margin: "0 0 10px" }}>{scan.note}</p>
          {scan.detected.length === 0 ? (
            <p className="mono" style={{ fontSize: 12.5, color: "var(--fg-3)", margin: 0 }}>
              Nothing found.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {scan.detected.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="mono" style={{ fontSize: 12.5, flex: 1 }}>
                    {d.label} <span style={{ color: "var(--fg-3)" }}>{d.version}</span>
                  </span>
                  <button
                    className="btn"
                    style={{ fontSize: 11 }}
                    onClick={() =>
                      add({
                        id: d.id,
                        label: d.label,
                        kind: "cli",
                        role: "extractor",
                        enabled: true,
                        command: d.command,
                        args: d.args ?? [],
                        note: d.version,
                      })
                    }
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ padding: "14px 16px", marginTop: 12 }}>
        <p className="label" style={{ marginTop: 0 }}>Add manually</p>
        <div className="prov-form">
          <input
            className="prov-in"
            placeholder="Name"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
          <select
            className="prov-in"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as "api" | "cli" })}
          >
            <option value="cli">Local CLI</option>
            <option value="api">Hosted API</option>
          </select>
          <select
            className="prov-in"
            value={draft.role}
            onChange={(e) => setDraft({ ...draft, role: e.target.value as "engine" | "extractor" })}
          >
            <option value="extractor">Extractor</option>
            <option value="engine">Engine</option>
          </select>
          {draft.kind === "cli" ? (
            <>
              <input
                className="prov-in"
                placeholder="Command, e.g. claude"
                value={draft.command}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
              <input
                className="prov-in"
                placeholder="Args, e.g. -p"
                value={draft.args}
                onChange={(e) => setDraft({ ...draft, args: e.target.value })}
              />
            </>
          ) : (
            <input
              className="prov-in"
              placeholder="Key variable, e.g. MISTRAL_API_KEY"
              value={draft.env}
              onChange={(e) => setDraft({ ...draft, env: e.target.value })}
            />
          )}
          <button className="btn" onClick={addManual}>
            Add
          </button>
        </div>
      </div>

      {message && (
        <p className="mono" style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 10 }}>
          {message}
        </p>
      )}

      <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 10, maxWidth: "72ch" }}>
        A CLI provider runs on the machine that has it installed, so it costs
        nothing per call and needs no key. Nothing here is executed by this
        website: the command is only ever run by the local pipeline.
      </p>
    </section>
  );
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
