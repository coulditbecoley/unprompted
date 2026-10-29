// After `next build`: the admin routes must ship held weeks and no public
// server route may. Next applies tracing excludes after includes and ignored
// a negated key, so this is checked on the real build output, not assumed.
import fs from "node:fs";
import path from "node:path";

const root = path.join(".next", "server", "app");
const traces = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".nft.json")) traces.push(full);
  }
})(root);

const held = (file) => JSON.parse(fs.readFileSync(file, "utf8")).files.filter((f) => f.includes("data/held")).length;
const isAdmin = (file) => path.relative(root, file).split(path.sep).includes("admin");
// The home page is prerendered (static), so its trace is never deployed as a function.
const isStatic = (file) => path.relative(root, file) === "page.js.nft.json";

const problems = [];
for (const file of traces) {
  const count = held(file);
  if (isAdmin(file) && count === 0) problems.push(`${file}: admin route lost data/held`);
  if (!isAdmin(file) && !isStatic(file) && count > 0) problems.push(`${file}: public route ships ${count} held files; add it to PUBLIC_ROUTES in next.config.ts`);
}
if (!traces.length) problems.push("no traces found; run next build first");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`traces ok: ${traces.length} checked`);
