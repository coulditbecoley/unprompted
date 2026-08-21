import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "@/lib/data";
import { TrimTop } from "@/components/ui";

export const metadata: Metadata = {
  title: "Method",
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
  const blocks = renderMarkdown(raw);

  return (
    <section className="shell section">
      <div className="panel" style={{ marginBottom: 26, padding: "16px 20px 16px 28px" }}>
        <TrimTop />
        <p style={{ fontSize: 14.5, margin: 0, color: "var(--fg-2)" }}>
          This page is rendered directly from{" "}
          <a href="https://github.com/coulditbecoley/unprompted/blob/main/METHODOLOGY.md">
            METHODOLOGY.md
          </a>{" "}
          in the public repository, so what you read here is the file the pipeline
          actually runs under.
        </p>
      </div>
      <div className="prose">{blocks}</div>
    </section>
  );
}

/**
 * A deliberately small markdown renderer: headings, tables, lists, rules,
 * paragraphs, plus inline bold, code and links. Adding a markdown dependency to
 * render one file we control would be more machinery than the job needs.
 */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
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
      const text = inline(heading[2]);
      if (level === 1) out.push(<h1 key={key++} style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, margin: "0 0 14px" }}>{text}</h1>);
      else if (level === 2) out.push(<h2 key={key++}>{text}</h2>);
      else out.push(<h3 key={key++}>{text}</h3>);
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
        <div key={key++} style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>{head.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr>
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

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      out.push(
        <ul key={key++}>
          {items.map((it, n) => <li key={n}>{inline(it)}</li>)}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      out.push(
        <ol key={key++}>
          {items.map((it, n) => <li key={n}>{inline(it)}</li>)}
        </ol>,
      );
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^[#|\-*>`]|^\d+\./.test(lines[i])) {
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
