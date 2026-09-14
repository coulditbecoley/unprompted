import { CATEGORIES } from "@/lib/categories";
import { runInstant } from "@/lib/schedule";
import {
  categoryLabel,
  loadHistory,
  movement,
  standings,
  theSnub,
} from "@/lib/data";

export const dynamic = "force-static";

const SITE = "https://unprompted.report";

/**
 * The weekly chart as an Atom feed.
 *
 * This is deliberately the primary "get it without coming back" mechanism
 * rather than an email list. A feed needs no database, no consent record, no
 * unsubscribe flow and no GDPR surface, all of which would be real machinery
 * bolted onto a project whose whole architecture is "the repository is the
 * interface".
 *
 * It also means the email digest is configuration rather than a system we own:
 * any RSS-to-email provider can turn this into a weekly send without a line of
 * code here.
 */
export function GET() {
  // Every live category, not just the flagship. The feed is the publication's
  // "get it without coming back" mechanism, and a subscriber who follows it
  // should receive every chart that publishes, not one of three.
  const weeks = CATEGORIES.flatMap((category) => {
    const history = loadHistory(category.slug);
    return history
      .slice()
      .reverse()
      .map((run, i) => ({ run, older: history[history.length - 2 - i] }));
  }).sort((x, y) => y.run.run_date.localeCompare(x.run.run_date));

  const updated =
    weeks.length > 0
      ? runInstant(weeks[0].run.run_date).toISOString()
      : new Date(0).toISOString();

  const entries = weeks
    .map(({ run, older }) => {
      const board = standings(run);
      const moves = movement(board, older ? standings(older) : []);
      const snub = theSnub(moves);
      const leader = board[0];
      const label = categoryLabel(run.category);
      const measured = run.measured_on || run.run_date;

      const title = leader
        ? `${label}, measured ${measured}: ${leader.brand} named first in ${Math.round(leader.firstShare * 100)}% of runs`
        : `${label}, measured ${measured}: no brand was named`;

      const rows = board
        .slice(0, 8)
        .map(
          (b, n) =>
            `<li>${n + 1}. <strong>${esc(b.brand)}</strong> — named in ${b.named} of ${b.totalRuns} runs, first in ${Math.round(b.firstShare * 100)}%</li>`,
        )
        .join("");

      const body = [
        run.source_run ? `<p>Re-read on ${esc(run.run_date)}; originally measured ${esc(measured)}.</p>` : "",
        `<p>${esc(label)}. ${run.runs_per_question} runs per question across ${run.engines.length} engine${run.engines.length === 1 ? "" : "s"} (${esc(run.engines.join(", "))}), method v${run.method_version}.</p>`,
        `<ol>${rows}</ol>`,
        snub
          ? `<p><strong>The Snub:</strong> ${esc(snub.brand)} — ${snub.isDropout ? "named last week, not named once this week" : `down ${Math.abs(snub.rotationDelta)} points`}.</p>`
          : "",
        `<p><a href="${SITE}/chart/${run.category}/${run.run_date}">See the full board</a> · <a href="https://github.com/coulditbecoley/unprompted/tree/main/data/runs">check the raw data</a></p>`,
      ].join("");

      return `  <entry>
    <title>${esc(title)}</title>
    <link href="${SITE}/chart/${run.category}/${run.run_date}"/>
    <id>tag:unprompted.report,${run.run_date}:${run.category}</id>
    <updated>${runInstant(run.run_date).toISOString()}</updated>
    <content type="html">${esc(body)}</content>
  </entry>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Unprompted</title>
  <subtitle>What AI recommends when nobody's paying. A weekly chart of which brands AI assistants actually name.</subtitle>
  <link href="${SITE}/feed.xml" rel="self"/>
  <link href="${SITE}"/>
  <id>${SITE}/</id>
  <updated>${updated}</updated>
  <author><name>Skald Studio</name><uri>https://skaldstudio.io</uri></author>
${entries}
</feed>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
