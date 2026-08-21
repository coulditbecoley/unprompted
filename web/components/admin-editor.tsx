"use client";

import { useState } from "react";

type Target = "questions" | "aliases";

/**
 * Saving here opens a commit on the public repo. It is deliberately not an
 * instant write: the whole credibility argument is that method changes are
 * public and timestamped, and a database write would make that a promise
 * instead of a fact.
 */
export function AdminEditor({
  label,
  target,
  initial,
  note,
}: {
  label: string;
  target: Target;
  initial: string;
  note: string;
}) {
  const [body, setBody] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const dirty = body !== initial;

  async function save() {
    setStatus("saving");
    setMessage("");
    try {
      const res = await fetch("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content: body }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; url?: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setMessage(data.error ?? `Save failed (${res.status})`);
        return;
      }
      setStatus("done");
      setMessage(data.url ? `Committed. ${data.url}` : "Committed.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="panel" style={{ padding: "20px 22px 20px 30px", marginBottom: 16 }}>
      <span className="carbon trim-left" aria-hidden="true" />
      <h3 style={{ marginBottom: 4 }}>{label}</h3>
      <p style={{ fontSize: 13.5, color: "var(--fg-3)", margin: "0 0 12px" }}>{note}</p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
        rows={16}
        aria-label={`${label} source`}
        style={{
          width: "100%",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.7,
          padding: 14,
          background: "var(--bg)",
          color: "var(--fg)",
          border: "1px solid var(--rule-2)",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            padding: "9px 16px",
            background: dirty ? "var(--fg)" : "var(--surface-2)",
            color: dirty ? "var(--bg)" : "var(--fg-3)",
            border: "1px solid var(--rule-2)",
            cursor: dirty ? "pointer" : "not-allowed",
          }}
        >
          {status === "saving" ? "COMMITTING…" : "COMMIT TO REPO"}
        </button>

        {dirty && status === "idle" && (
          <span className="mono pending" style={{ fontSize: 11.5 }}>
            unsaved changes
          </span>
        )}
        {message && (
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              color: status === "error" ? "var(--fall)" : "var(--rise)",
            }}
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
