"use client";

import { useState } from "react";

/**
 * The return mechanism.
 *
 * Both options are offered plainly and the feed is not treated as the lesser
 * one: for this audience it is often the better answer, and it is the option
 * that works without handing anybody an address.
 *
 * Nothing here gates anything. The chart is fully readable without it, which is
 * the whole strategy.
 */
export function Subscribe() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setState("sending");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (res.ok && data.ok) {
        setState("done");
        setMessage("Done. You will get the chart every Monday.");
        setEmail("");
        return;
      }
      setState("error");
      setMessage(data.error ?? "That did not work.");
    } catch {
      setState("error");
      setMessage("Could not reach the server.");
    }
  }

  return (
    <section className="subscribe">
      <span className="trim-top" aria-hidden="true" />
      <div className="subscribe-body">
        <p className="label">Get it every week</p>
        <h2 className="subscribe-head">
          The chart updates every Monday. Have it come to you.
        </h2>
        <p className="subscribe-lead">
          No account, no paywall, and nothing here is gated. Everything on this
          site stays free to read whether you subscribe or not.
        </p>

        <form onSubmit={submit} className="subscribe-form">
          <label htmlFor="subscribe-email" className="sr-only">
            Email address
          </label>
          <input
            id="subscribe-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="subscribe-input mono"
            disabled={state === "sending"}
          />
          <button
            type="submit"
            className="share-btn subscribe-submit"
            disabled={state === "sending" || !email.trim()}
          >
            {state === "sending" ? "SENDING…" : "EMAIL ME THE CHART"}
          </button>
        </form>

        {message && (
          <p
            className="mono subscribe-msg"
            data-state={state}
            role={state === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        )}

        <p className="subscribe-alt mono">
          Prefer a feed?{" "}
          <a href="/feed.xml">Subscribe by RSS →</a> Same chart, no address
          needed.
        </p>
      </div>
    </section>
  );
}
