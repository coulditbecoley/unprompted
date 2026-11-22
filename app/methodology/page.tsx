import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";

import { CATEGORIES } from "@/lib/categories";
import { latestRun, REPO_ROOT } from "@/lib/data";
import { TrimTop } from "@/components/ui";

export const metadata: Metadata = {
  title: "How we measure AI brand mentions",
  alternates: { canonical: "/methodology" },
  openGraph: { url: "/methodology", type: "website", siteName: "Unprompted", title: "Unprompted methodology", description: "How buying questions, repeated answers and checks become the public chart." },
  description:
    "How we count each brand once per answer, leave out failed or declined answers, and keep rule changes out of trend lines. A plain summary, the words we use and the full method.",
};

/**
 * Rendered straight from METHODOLOGY.md so the published method and the
 * versioned file in the repository can never drift apart. A method page that
 * disagrees with the method file is worse than no method page.
 */
export default function MethodologyPage() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "METHODOLOGY.md"), "utf-8");
  const body = raw.replace(/^# Methodology\s*\n/, "");
  const introAt = body.indexOf("Unprompted measures");
  const content = (introAt > 0 ? body.slice(introAt) : body).replace(
    "A brand that was named last week and not once this week",
    "A brand that was named in the previous measurement and not once in the latest measurement",
  );
  const versions = CATEGORIES.map(category => {
    const bank = loadYaml(fs.readFileSync(path.join(REPO_ROOT, "questions", `${category.slug}.yml`), "utf-8")) as { method_version: number };
    return { category, current: bank.method_version, run: latestRun(category.slug) };
  });
  const blocks = renderMarkdown(content);
  const headings = [...content.matchAll(/^#{2,3} (.+)$/gm)].map(m => ({ text: m[1].trim(), id: headingId(m[1].trim()) }));

  return (
    <section className="shell section method-page">
      <h1 className="display page-title rise">How Unprompted works.</h1>
      <p className="section-lead">
        We ask AI assistants the questions real buyers ask, count which brands
        they mention, and publish every answer so you can check us.
      </p>
      <nav className="evidence-links" aria-label="Start here">
        <a href="#glossary">The words we use</a>
        <a href="#full-method">The full technical method</a>
        <a href="/categories">See the results</a>
      </nav>
      <p className="label codex-section-label">Process</p>
      <h2 className="sub-h">From questions to published results</h2>
      <p className="cmp-note">Five steps, every week.</p>
      <ol className="method-flow" role="list" aria-label="From questions to published results">
        {[
          ["Ask", "We keep a fixed list of buying questions for each category."],
          ["Repeat", "Each assistant gets each question five times."],
          ["Read", "We record the brands, their order and the sources. Names we do not recognise are set aside."],
          ["Check", "Results that fail our checks stay off the chart."],
          ["Publish", "Results that pass are published with the full answers."],
        ].map(([title, detail], i) => <li className="panel rise" key={title} style={{ "--i": i } as React.CSSProperties}>
          <span className="mono method-step" aria-hidden="true">{i + 1}</span>
          <h3 id={`process-${title.toLowerCase()}`}>{title}</h3><p>{detail}</p>
          {i < 4 && <span className="method-arrow" aria-hidden="true">&rarr;</span>}
        </li>)}
      </ol>

      <p className="label codex-section-label">In plain words</p>
      <h2 className="sub-h" id="what-the-numbers-mean">What the numbers mean, and what they do not</h2>
      <p className="cmp-note">Ten things worth knowing before you quote a number from this site.</p>
      <div className="method-points">
        {POINTS.map(([title, detail]) => <div className="panel" key={title}><h3>{title}</h3><p>{detail}</p></div>)}
      </div>

      <div className="methodology-copy">
        <p className="label codex-section-label">Definitions</p>
        <h2 className="sub-h" id="glossary">The words we use <SectionLink id="glossary" label="The words we use" /></h2>
        <p className="cmp-note">Six terms that appear on every chart.</p>
        <dl className="method-glossary">
          <dt id="glossary-answer">Answer</dt><dd>One response to one question from one assistant. Failed or declined answers are left out of the percentages.</dd>
          <dt id="glossary-named">Mentioned</dt><dd>The brand appears anywhere in an answer. Repeating it in the same answer still counts once.</dd>
          <dt id="glossary-first">Named first</dt><dd>The first charted brand in an answer. This shows visibility, not product quality.</dd>
          <dt id="glossary-reading">Results</dt><dd>One published set of answers and the numbers counted from them. Results can be re-checked later without asking the assistants again. When that happens, the page shows the date the answers were collected and the date of the re-check.</dd>
          <dt id="glossary-method-version">Counting rules</dt><dd>The numbered version of the rules for collecting and counting answers. When the rules change, earlier results cannot be fairly compared with later ones.</dd>
          <dt id="glossary-too-close">Too close to call</dt><dd>A gap or change small enough that it could be chance. We still show the number, but we do not call it a lead or a move.</dd>
        </dl>
      </div>

      <p className="label codex-section-label">Version history</p>
      <h2 className="sub-h" id="recent-changes">Counting rules by category</h2>
      <p className="cmp-note">The rules in use today can be newer than the latest published results, when newer results are being held back for checks.</p>
      <div className="method-table" role="region" aria-label="Method versions by category" tabIndex={0}>
        <table>
          <caption className="sr-only">Counting rules in use now and for the latest published results</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Rules in use now</th><th scope="col">Rules for the latest results</th><th scope="col">Measured</th><th scope="col">Published</th></tr></thead>
          <tbody>{versions.map(({ category, current, run }) => <tr key={category.slug}>
            <td>{category.label}</td><td>v{current}</td>
            {run ? <>
              <td>v{run.method_version}</td><td>{run.measured_on || run.run_date}</td><td>{run.run_date}</td>
            </> : <td colSpan={3}>No published results</td>}
          </tr>)}</tbody>
        </table>
      </div>

      <div className="panel reveal method-source">
        <TrimTop />
        <p style={{ fontSize: 14.5, margin: 0, color: "var(--fg-2)" }}>
          Found a mistake? <a href="https://github.com/coulditbecoley/unprompted/issues">Open an issue</a>.
          Corrections are added as new records. Old ones are never edited. The questions, the
          code and every answer are public in the{" "}
          <a href="https://github.com/coulditbecoley/unprompted">repository</a>, so anyone can
          run the same steps and check the result.
        </p>
      </div>

      <details className="method-full" id="full-method">
        <summary>
          <span className="sub-h">The full technical method</span>
          <span className="cmp-note">Every rule, every check and the dated change log, written for people who want to audit the work.</span>
        </summary>
        <p className="cmp-note">
          This text comes straight from{" "}
          <a href="https://github.com/coulditbecoley/unprompted/blob/main/METHODOLOGY.md">METHODOLOGY.md</a>{" "}
          in the public repository. It uses the project&rsquo;s working terms: an engine is an
          assistant, a reading or run is a set of results, and the method version is the
          counting rules.
        </p>
        <div className="method-layout">
          <details className="method-toc panel" open>
            <summary>In the full method</summary>
            <nav aria-label="Methodology sections">{headings.map(h => <a key={h.id} href={`#${h.id}`}>{h.text}</a>)}</nav>
          </details>
          <div className="prose methodology-copy">
            {blocks}
          </div>
        </div>
      </details>
    </section>
  );
}

/** The reader's version. METHODOLOGY.md is the method and wins any conflict. */
const POINTS: [string, string][] = [
  ["It shows visibility, not quality", "A brand that is named first is the one the assistant said first. That does not make it the better product."],
  ["Every question is asked five times", "Assistants answer differently each time, so one answer tells you little. Each assistant gets each question five times, and every answer is counted."],
  ["Counts sit beside percentages", "A percentage is shown with the number of answers behind it, so you can see how much it rests on."],
  ["Small gaps can be chance", "With a few hundred answers, a difference of a few points can happen by luck. We call those too close to call and show no arrow. Five repeats of one question are not five independent tests either, so treat even a clear lead with care."],
  ["Failed or declined answers are left out", "If a request fails, the assistant declines to recommend anything, or the answer cannot be read, it stays in the records but is not counted for or against any brand."],
  ["Only brands on the chart are ranked", "Named first means first among the brands this chart tracks. A name we do not recognise is set aside and never appears on the chart."],
  ["Changed rules break the trend", "When the questions, the assistants or the counting rules change, we do not show a change against earlier results. The comparison would not be fair."],
  ["We ask through developer access, not the apps", "We ask each assistant through the direct connection its maker offers to developers, with web search switched on where it has one. The apps people use add their own instructions, personalisation and shopping features, so their answers can differ."],
  ["An AI reads the answers", "By default a Claude model reads each answer and lists the brands in it. Claude is also one of the assistants we measure, so it is counting answers about its own maker’s products. We do not know how much that affects the results. Tone is judged by an AI too, so trust it less than the counts."],
  ["Who runs this", "Unprompted is run by Skald Studio, which sells AI visibility work. No company on a chart has a say in the questions, the rules or the results. No placement is for sale, and no charted company is a Skald Studio client."],
];

/**
 * A deliberately small markdown renderer: headings, tables, lists, rules,
 * paragraphs, plus inline bold, code and links. Adding a markdown dependency to
 * render one file we control would be more machinery than the job needs.
 */
const METHOD_HEADERS: Record<string, [string, string]> = {
  "What we do, every week": ["Collection", "How buying questions become a published measurement."],
  "Why we ask five times instead of once": ["Sampling", "Repeated answers show how often a brand appears."],
  "How much of a change is real": ["Uncertainty", "Small samples limit what a change can tell us."],
  "What we measure, and what we do not": ["Scope", "API answers measure visibility, not product quality."],
  "Active engines": ["Providers", "The assistants and models used for each measurement."],
  "Never break the series": ["Comparability", "Method changes determine which readings can be compared."],
  "Disclosure": ["Operator", "Who runs the chart and how the work is funded."],
  "A conflict we have to declare": ["Independence", "How we disclose and handle conflicts of interest."],
  "Corrections": ["Review", "How mistakes are reported and corrected."],
};

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.startsWith("---")) {
      out.push(<hr className="rule" key={key++} style={{ margin: "32px 0" }} />);
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const id = headingId(heading[2]);
      const text = <>{inline(heading[2])} <SectionLink id={id} label={heading[2]} /></>;
      if (level === 1) out.push(<h2 className="sub-h" id={id} key={key++}>{text}</h2>);
      else if (level === 2 && METHOD_HEADERS[heading[2]]) {
        const [label, lead] = METHOD_HEADERS[heading[2]];
        out.push(<p className="label codex-section-label" key={key++}>{label}</p>);
        out.push(<h2 className="sub-h" id={id} key={key++}>{text}</h2>);
        out.push(<p className="cmp-note" key={key++}>{lead}</p>);
      } else if (level === 2) out.push(<h2 id={id} key={key++}>{text}</h2>);
      else out.push(<h3 id={id} key={key++}>{text}</h3>);
      i += 1;
      continue;
    }

    // Table: a header row followed by a separator row.
    if (line.startsWith("|") && lines[i + 1]?.includes("---")) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) {
        body.push(cells(lines[i]));
        i += 1;
      }
      out.push(
        <div key={key++} className="method-table" role="region" aria-label={`Table: ${head.join(", ")}`} tabIndex={0}>
          <p className="table-scroll-note">Scroll horizontally to read all columns.</p>
          <table>
            <thead>
              <tr>{head.map((c, n) => <th scope="col" key={n}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, n) => (
                <tr key={n}>{row.map((c, m) => <td key={m}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        <pre
          key={key++}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            background: "var(--surface-2)",
            padding: "14px 16px",
            overflowX: "auto",
          }}
        >
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const marker = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items: string[] = [];
      const start = ordered ? Number.parseInt(line, 10) : undefined;
      while (i < lines.length && marker.test(lines[i])) {
        const item = [lines[i].replace(marker, "")];
        i += 1;
        // Wrapped prose belongs to the preceding item, not a new paragraph/list.
        while (i < lines.length && lines[i].trim() && !/^\s*(?:#{1,6}\s|[-*]\s|\d+\.\s|```|\||---)/.test(lines[i])) {
          item.push(lines[i].trim());
          i += 1;
        }
        items.push(item.join(" "));
      }
      const children = items.map((item, n) => <li key={n}>{inline(item)}</li>);
      out.push(ordered ? <ol start={start} key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,4}\s|\||[-*]\s|>\s|```|---|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) out.push(<p key={key++}>{inline(para.join(" "))}</p>);
    else i += 1;
  }

  return out;
}

function cells(row: string): string[] {
  return row.split("|").slice(1, -1).map((c) => c.trim());
}

/** Inline bold, code and links. Split on all three in one pass. */
function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let n = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    const token = match[0];

    if (token.startsWith("**")) {
      parts.push(<strong key={n++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={n++}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;
      parts.push(
        <a key={n++} href={link[2]}>
          {link[1]}
        </a>,
      );
    }
    last = index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function headingId(text: string): string {
  return `method-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
