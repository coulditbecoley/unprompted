// Fetches the React Bits Pro components this site uses into
// components/react-bits/ (gitignored). Their licence forbids publishing the
// source in a public repository, so it is downloaded at install and build time
// with REACTBITS_LICENSE_KEY instead of being committed.
//
// Without a key, or if the registry is down, a stub that renders nothing is
// written so the site still builds and falls back to its CSS background.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ITEMS = ["flicker"];
const STUB_MARK = "react-bits-stub";
const dir = join(process.cwd(), "components", "react-bits");

function key() {
  if (process.env.REACTBITS_LICENSE_KEY) return process.env.REACTBITS_LICENSE_KEY;
  try {
    const line = readFileSync(join(process.cwd(), ".env.local"), "utf8")
      .split(/\r?\n/).find((l) => l.startsWith("REACTBITS_LICENSE_KEY="));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

mkdirSync(dir, { recursive: true });
const licence = key();

for (const item of ITEMS) {
  const target = join(dir, `${item}.tsx`);
  const have = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (have && !have.includes(STUB_MARK)) continue; // real component already here
  try {
    if (!licence) throw new Error("no REACTBITS_LICENSE_KEY");
    const res = await fetch(`https://pro.reactbits.dev/api/r/starter/${item}-css.json`, {
      headers: { Authorization: `Bearer ${licence}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`registry answered ${res.status}`);
    const { files } = await res.json();
    for (const f of files) {
      const out = join(process.cwd(), f.path);
      mkdirSync(dirname(out), { recursive: true });
      // Third-party source: not held to this project's compiler settings.
      writeFileSync(out, f.path.endsWith(".tsx") ? `// @ts-nocheck\n${f.content}` : f.content);
    }
    console.log(`react-bits: fetched ${item}`);
  } catch (err) {
    if (have) continue; // keep the existing stub
    writeFileSync(
      target,
      `// ${STUB_MARK}: written by scripts/fetch-react-bits.mjs because the real\n// component could not be fetched (${String(err.message).replace(/\s+/g, " ")}).\nexport default function Stub(_props: Record<string, unknown>) {\n  return null;\n}\n`,
    );
    console.warn(`react-bits: ${item} not fetched (${err.message}); wrote a stub`);
  }
}
