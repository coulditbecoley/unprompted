import { SectionLink } from "@/components/contact";
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@/lib/data";
import { TrimTop } from "@/components/ui";

export const metadata: Metadata = {
  title: "How we measure AI brand mentions",
  openGraph: { title: "Unprompted methodology", description: "How questions, repeated answers, and publication checks produce the public chart." },
  description:
    "Exactly how Unprompted measures what AI assistants recommend, including what it deliberately does not measure.",
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
  const changes = introAt > 0 && body.startsWith("**Version") ? body.slice(0, introAt).trim() : "";
  const content = changes ? body.slice(introAt) : body;
  const blocks = renderMarkdown(content);
  const headings = [...content.matchAll(/^#{2,3} (.+)$/gm)].map(m => ({ text: m[1].trim(), id: headingId(m[1].trim()) }));

  return (
    <section className="shell section">
      <h1 className="display page-title rise">How the measurement works.</h1>
      <p className="section-lead">
        How we count brand mentions in AI answers, check the results, and decide
        what we can fairly compare. Use this guide to understand what the charts
        can and cannot tell you.
      </p>
      {changes && <aside className="panel method-changes" aria-labelledby="recent-changes">
        <h2 id="recent-changes">What changed recently</h2>
        <div className="prose">{renderMarkdown(changes)}</div>
      </aside>}
      <ol className="method-flow" aria-label="From questions to published results">
        {[
          ["Ask", "Repeat the category’s buying questions across AI assistants."],
          ["Count", "Read the answers and record which brands were named."],
          ["Check", "Hold results that fail the publication checks."],
          ["Publish", "Keep passing results and their evidence in the public archive."],
        ].map(([title, detail], i) => <li className="panel rise" key={title} style={{ "--i": i } as React.CSSProperties}>
          <span className="mono method-step" aria-hidden="true">{i + 1}</span>
          <h2 id={`process-${title.toLowerCase()}`}>{title}</h2><p>{detail}</p>
        </li>)}
      </ol>
      <div className="panel reveal" style={{ marginBottom: 26, padding: "16px 20px 16px 28px" }}>
        <TrimTop />
        <p style={{ fontSize: 14.5, margin: 0, color: "var(--fg-2)" }}>
          The full method below comes from{" "}
          <a href="https://github.com/coulditbecoley/unprompted/blob/main/METHODOLOGY.md">
            METHODOLOGY.md
          </a>{" "}
          in the public repository. Each published measurement records the
          method version used at the time.
        </p>
      </div>
      <div className="method-layout">
        <details className="method-toc panel" open>
          <summary>On this page</summary>
          <nav aria-label="Methodology sections">{headings.map(h => <a key={h.id} href={`#${h.id}`}>{h.text}</a>)}</nav>
        </details>
        <div className="prose methodology-copy">{blocks}</div>
      </div>
    </section>
  );
}

/**
 * A deliberately small markdown renderer: headings, tables, lists, rules,
 * paragraphs, plus inline bold, code and links. Adding a markdown dependency to
 * render one file we control would be more machinery than the job needs.
 */
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
      else if (level === 2) out.push(<h2 id={id} key={key++}>{text}</h2>);
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
        <div key={key++} style={{ overflowX: "auto" }} role="region" aria-label={`Table: ${head.join(", ")}`} tabIndex={0}>
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
