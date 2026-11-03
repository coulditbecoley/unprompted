import { MAX_ENGINE_ERROR_RATE, QUARANTINE_MATERIAL, answered, quarantineKey, type RunRecord } from "./data";

/**
 * What the admin page concludes from the committed run report and readings.
 * No file reads here, so each conclusion can be tested with plain values.
 */

export type LastRun = {
  status: string;
  runDate: string | null;
  at: string | null;
  detail: string;
  categories: Record<string, unknown>;
};

export type Need = { id: string; title: string; details: string[]; href: string };

/** data/last-run.json as text, or null when it is missing or not an object. */
export function parseLastRun(text: string): LastRun | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    // The report date is not the timestamp or the latest published reading.
    const runDate = typeof raw.run_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.run_date)
      && Number.isFinite(Date.parse(raw.run_date))
      && new Date(raw.run_date).toISOString().slice(0, 10) === raw.run_date ? raw.run_date : null;
    return {
      status: typeof raw.status === "string" ? raw.status : "unknown",
      runDate,
      at: typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at)) ? raw.at : null,
      detail: typeof raw.detail === "string" ? raw.detail : "",
      categories: raw.categories && typeof raw.categories === "object" && !Array.isArray(raw.categories)
        ? raw.categories as Record<string, unknown> : {},
    };
  } catch {
    return null;
  }
}

export function readingNames(reading: RunRecord) {
  const names = new Map<string, { name: string; count: number }>();
  for (const name of Array.isArray(reading.quarantined) ? reading.quarantined : []) {
    if (typeof name !== "string" || !name.trim()) continue;
    const key = quarantineKey(name);
    if (!key) continue;
    const entry = names.get(key) ?? { name, count: 0 };
    entry.count += 1;
    names.set(key, entry);
  }
  const total = answered(reading).length;
  return {
    reading,
    total,
    names: [...names.values()]
      .map(n => ({ ...n, material: total > 0 && n.count / total >= QUARANTINE_MATERIAL }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

function adviceFor(engine: string, errors: string): string {
  if (/\b401\b|unauthori[sz]ed|invalid.api.key/i.test(errors)) return `Check or replace the ${engine} credential on the run machine and confirm its access. Authentication was rejected.`;
  if (/\b403\b|forbidden/i.test(errors)) return `Check the ${engine} account's permissions and model access on the run machine.`;
  if (/\b429\b|rate.limit|quota|billing|credit.balance/i.test(errors)) return `Check the ${engine} usage limits and billing before the next run.`;
  if (/timed?.?out|timeout/i.test(errors)) return `Check the ${engine} service and the run machine for the recorded timeout before the next run.`;
  return `Investigate the recorded ${engine} error before the next run.`;
}

/**
 * Only what a person must act on. A source appears once it passes the limit
 * that holds a week in some category: one failed answer in a healthy run is the
 * retry budget doing its job, not a task. A held category nothing here explains
 * is still listed, from the report's own reasons.
 */
export function buildNeeds(
  lastRun: LastRun | null,
  readings: RunRecord[],
  evidenceErrors: string[],
  categoryLabel: (slug: string) => string,
): Need[] {
  const needs: Need[] = [];
  const date = lastRun?.runDate;
  const dated = readings.filter(r => r.run_date === date);
  const explained = new Set<string>();
  const failures = new Map<string, { categories: Set<string>; errors: Map<string, number> }>();

  for (const reading of dated) {
    const bySource = new Map<string, { calls: number; errors: Map<string, number> }>();
    const row = (source: string) => {
      const found = bySource.get(source) ?? { calls: 0, errors: new Map<string, number>() };
      bySource.set(source, found);
      return found;
    };
    for (const answer of reading.extractions) {
      const engine = row(answer.engine);
      engine.calls += 1;
      if (typeof answer.error !== "string" || !answer.error.trim()) continue;
      engine.errors.set(answer.error, (engine.errors.get(answer.error) ?? 0) + 1);
    }
    for (const [source, { calls, errors }] of bySource) {
      const count = [...errors.values()].reduce((sum, n) => sum + n, 0);
      if (!calls || count / calls <= MAX_ENGINE_ERROR_RATE) continue;
      // The pipeline counts every error per engine; attribute its cause only after that check.
      for (const [error, n] of errors) {
        const cause = error.startsWith("extract failed:") ? "extractor" : source;
        const failure = failures.get(cause) ?? { categories: new Set<string>(), errors: new Map<string, number>() };
        failure.categories.add(reading.category);
        failure.errors.set(error, (failure.errors.get(error) ?? 0) + n);
        failures.set(cause, failure);
      }
      explained.add(reading.category);
    }
  }
  for (const [engine, failure] of failures) {
    needs.push({ id: `engine-${engine}`, title: `${engine}: recorded errors`, href: "#latest-run-heading",
      details: [adviceFor(engine, [...failure.errors.keys()].join("\n")),
        `${date}: ${[...failure.categories].map(categoryLabel).join(", ")}.`,
        ...[...failure.errors].map(([error, count]) => `${error} (${count} answer record${count === 1 ? "" : "s"})`)] });
  }
  for (const reading of dated) {
    const material = readingNames(reading).names.filter(n => n.material);
    if (!material.length) continue;
    explained.add(reading.category);
    needs.push({ id: `names-${reading.category}`, title: `${categoryLabel(reading.category)}: review ${material.length} unrecognised name${material.length === 1 ? "" : "s"}`,
      href: `/admin?category=${encodeURIComponent(reading.category)}#alias-editor`,
      details: [`Recorded on ${date}: ${material.map(n => n.name).join(", ")}.`,
        "These reached the run's review threshold. Check the current aliases before deciding; edits since the run are not reflected here. Alias decisions stay manual."] });
  }
  for (const [slug, value] of Object.entries(lastRun?.categories ?? {})) {
    const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const outcome = typeof row.outcome === "string" ? row.outcome : "unknown";
    const reasons = Array.isArray(row.reasons) ? row.reasons.filter((r): r is string => typeof r === "string" && Boolean(r.trim())) : [];
    if (["failed", "not_started", "not_run"].includes(outcome) || (outcome === "held" && !explained.has(slug))) {
      needs.push({ id: `category-${slug}`, title: `${categoryLabel(slug)}: ${outcome.replaceAll("_", " ")}`,
        href: "#latest-run-heading", details: reasons.length ? reasons : ["Review the committed run report; no reason was recorded."] });
    }
    if (!["passed", "held", "failed", "not_started", "not_run"].includes(outcome)
        || (["passed", "held"].includes(outcome) && !dated.some(r => r.category === slug))) {
      needs.push({ id: `missing-${slug}`, title: `${categoryLabel(slug)}: evidence is incomplete`, href: "#latest-run-heading",
        details: ["The category outcome or its reading is missing or unreadable. Check the committed report and archive."] });
    }
  }
  if (!date || !lastRun || !["measured", "published", "held", "failed"].includes(lastRun.status)
      || Object.keys(lastRun.categories).length === 0
      || (["held", "failed"].includes(lastRun.status) && needs.length === 0)) {
    needs.push({ id: "report", title: "Review the latest run report", href: "#latest-run-heading",
      details: [lastRun?.detail || "The dated category report is missing or incomplete; there is not enough evidence to say nothing needs attention."] });
  }
  const errors = [...new Set(evidenceErrors)];
  if (errors.length) needs.push({ id: "archive", title: "Restore unreadable run evidence", href: "#latest-run-heading", details: errors });
  return needs;
}
