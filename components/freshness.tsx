"use client";

import { useEffect, useState } from "react";

/**
 * Freshness and return.
 *
 * Two problems this solves at once. A figure with no date has to be taken on
 * faith, and a visitor with no idea when the chart updates has no reason to
 * come back. Both are cheap to answer and expensive to leave unanswered.
 *
 * The next-run time is computed from the schedule the run actually keeps rather
 * than hardcoded, so it cannot drift into a lie as weeks pass. That schedule
 * now lives in lib/schedule.ts, shared with the Atom feed: this file used to
 * hold its own copy that assumed 13:00 UTC, while the task has always run at
 * 13:00 in the operator's timezone, so the countdown was four hours early.
 */

import { nextRun } from "@/lib/schedule";

function relative(target: Date, now: Date): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function Freshness({ runDate }: { runDate: string }) {
  // Rendered only after mount: server and client clocks differ, and a
  // countdown baked into static HTML is stale the moment it is built.
  const [when, setWhen] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setWhen(relative(nextRun(now), now));
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="freshness">
      <span>MEASURED {runDate}</span>
      <span className="next" suppressHydrationWarning>
        {when ? `NEXT RUN ${when}` : "UPDATES EVERY MONDAY"}
      </span>
      <span className="spacer" />
      <a href="https://github.com/coulditbecoley/unprompted/tree/main/data/runs">
        CHECK THE RAW DATA →
      </a>
    </div>
  );
}

/**
 * Sharing is this publication's growth engine, so it gets a real affordance
 * rather than relying on the visitor to copy the address bar.
 */
export function ShareRow({ headline }: { headline: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${headline} — unprompted.report`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard is blocked in some contexts. The X link below still works,
      // so there is always a way to share.
    }
  }

  const intent = `https://x.com/intent/post?text=${encodeURIComponent(
    headline,
  )}&url=${encodeURIComponent("https://unprompted.report")}`;

  return (
    <div className="share-row">
      <button type="button" className="share-btn" onClick={copy} data-done={copied}>
        {copied ? "COPIED" : "COPY THIS RESULT"}
      </button>
      <a className="share-btn" href={intent} target="_blank" rel="noopener noreferrer">
        SHARE ON X
      </a>
    </div>
  );
}
