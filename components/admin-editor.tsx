"use client";

import { useState } from "react";
import { editDiff, unversionedChange } from "@/lib/admin-edit";

type Target = "questions" | "aliases";

/**
 * Saving here opens a commit on the public repo. It is deliberately not an
 * instant write: the whole credibility argument is that method changes are
 * public and timestamped, and a database write would make that a promise
 * instead of a fact.
 */
export function AdminEditor({
  category,
  label,
  target,
  initial,
  note,
}: {
  category: string;
  label: string;
  target: Target;
  initial: string;
  note: string;
}) {
  const [body, setBody] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error" | "conflict">("idle");
  const [message, setMessage] = useState("");
  const [reviewed, setReviewed] = useState<string | null>(null);

  const [baseline, setBaseline] = useState(initial);
  const dirty = body !== baseline;
  const warning = dirty && target === "questions" ? unversionedChange(baseline, body) : null;
  const canCommit = dirty && reviewed === body && !warning && status !== "saving" && status !== "conflict";

  async function save() {
    if (!canCommit) return;
    const submitted = body;
    setStatus("saving");
    setMessage("");
    try {
      const res = await fetch("/api/admin/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, category, content: submitted, baseline }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; url?: string };
      if (!res.ok || !data.ok) {
        setStatus(res.status === 409 ? "conflict" : "error");
        setMessage(data.error ?? `Save failed (${res.status})`);
        return;
      }
      setBaseline(submitted);
      setReviewed(null);
      setStatus("done");
      setMessage(data.url ? `Committed. ${data.url}` : "Committed.");
    } catch {
      setStatus("error");
      setMessage("Could not confirm the commit. Your edits are retained. Check the repository before retrying.");
    }
  }

  return (
    <div className="panel" style={{ padding: "20px 22px 20px 30px", marginBottom: 16 }}>
      
      <h3 style={{ marginBottom: 4 }}>{label}</h3>
      <p style={{ fontSize: 13.5, color: "var(--fg-3)", margin: "0 0 12px" }}>{note}</p>

      <textarea
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setReviewed(null);
          if (status !== "conflict") { setStatus("idle"); setMessage(""); }
        }}
        disabled={status === "saving"}
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

      {warning && <p role="alert" className="pending">{warning}</p>}
      {dirty && reviewed === body && <section aria-label={`${label} pending diff`}>
        <h4>Pending change</h4>
        <p>Removed lines start with −; added lines start with +. Unchanged beginning and end are omitted.</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12.5 }}>{editDiff(baseline, body) || "Only line endings changed."}</pre>
      </section>}

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" disabled={!dirty || status === "saving"} onClick={() => setReviewed(body)}>REVIEW CHANGES</button>
        <button
          type="button"
          onClick={save}
          disabled={!canCommit}
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            padding: "9px 16px",
            background: canCommit ? "var(--fg)" : "var(--surface-2)",
            color: canCommit ? "var(--bg)" : "var(--fg-3)",
            border: "1px solid var(--rule-2)",
            cursor: canCommit ? "pointer" : "not-allowed",
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
            role="status"
            style={{
              fontSize: 11.5,
              color: status === "error" || status === "conflict" ? "var(--down)" : "var(--up)",
            }}
          >
            {message}
          </span>
        )}
      </div>
      {status === "conflict" && <p role="alert">Your draft is still above. Copy it before <a href={`/admin?category=${encodeURIComponent(category)}`}>reloading the current file</a>, then merge your edits and review again.</p>}
    </div>
  );
}
