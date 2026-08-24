import { NextResponse } from "next/server";

import { isAuthorised } from "@/lib/auth";
import { KNOWN_CLIS, resolveOnPath } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Find which known CLI providers exist on the machine running this dashboard.
 *
 * Nothing here starts a process. Detection resolves each allowlisted name
 * against PATH and reports what it finds, which is the whole question being
 * asked: is this harness installed. That keeps the boundary in lib/providers.ts
 * absolute rather than "limited to an allowlist" — the web application never
 * spawns anything, so there is no argument array, no shell, and no version of
 * this file that can be talked into executing a registry value.
 *
 * It also fixes the case this route got wrong on Windows. These tools install
 * as `.CMD` shims, so `execFile("claude")` never found them by bare name, and
 * once found Node refuses to spawn a `.cmd` without a shell at all. The old
 * route therefore reported every harness missing on the one platform the
 * operator actually runs the pipeline on.
 *
 * On Vercel this finds nothing, which is correct rather than broken: a
 * serverless function cannot see the operator's laptop. The response says so in
 * words so the dashboard can explain itself instead of showing an error.
 */

export async function GET(request: Request) {
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const hosted = Boolean(process.env.VERCEL);

  const found = KNOWN_CLIS.map((cli) => {
    const resolved = hosted ? null : resolveOnPath(cli.command);
    return {
      id: cli.id,
      label: cli.label,
      engineId: cli.engineId,
      engineLabel: cli.engineLabel,
      command: cli.command,
      args: cli.args,
      // Shown in place of a version string, which cost a process to read. The
      // path is more useful anyway when two installs are fighting over a name.
      path: resolved ?? undefined,
      present: resolved !== null,
    };
  });

  return NextResponse.json({
    hosted,
    note: hosted
      ? "This dashboard is running on Vercel, which cannot see your machine. Run it locally with `npm run dev` to detect your CLIs."
      : "Scanned this machine's PATH.",
    detected: found.filter((f) => f.present),
    missing: found.filter((f) => !f.present).map((f) => f.command),
  });
}
