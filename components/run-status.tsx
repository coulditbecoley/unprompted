import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@/lib/data";

/**
 * What the last weekly run did, at the top of the operator's dashboard.
 *
 * The run happens on one machine at 1pm on a Monday and writes to a log file
 * nobody opens. A week that was held, or that measured everything and then
 * failed to push, looks exactly like a week that went fine: the site keeps
 * showing last Monday's date, which is what it would show anyway.
 *
 * The other half of the alert is a GitHub issue, which reaches a phone. This is
 * the half that is still here tomorrow, and it is committed with the run so git
 * keeps every outcome rather than only the current one.
 */

type Status = {
  status: "published" | "held" | "failed" | "unknown";
  detail: string;
  exit_code: number;
  at: string;
};

const WORD: Record<Status["status"], string> = {
  published: "published",
  held: "held for review",
  failed: "did not finish",
  unknown: "has not reported yet",
};

function load(): Status | null {
  try {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, "data", "last-run.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Status;
  } catch {
    return null;
  }
}

/** How long ago, in the coarsest unit that is still useful. */
function since(at: string): string {
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "";
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function RunStatus() {
  const last = load();
  if (!last) return null;

  const bad = last.status === "failed";
  const attention = bad || last.status === "held";

  return (
    <div className="run-status" data-status={last.status}>
      <span className="label run-status-word">
        Last run {WORD[last.status] ?? last.status}
      </span>
      <span className="run-status-detail">{last.detail}</span>
      <span className="mono run-status-when">{since(last.at)}</span>
      {attention && (
        <span className="mono run-status-flag" data-bad={bad}>
          {bad ? "needs a person" : "did not publish"}
        </span>
      )}
    </div>
  );
}
