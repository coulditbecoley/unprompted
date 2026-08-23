import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

import { isAuthorised } from "@/lib/auth";
import { KNOWN_CLIS } from "@/lib/providers";

const run = promisify(execFile);

export const dynamic = "force-dynamic";

/**
 * Find which known CLI providers exist on the machine running this dashboard.
 *
 * Two hard rules, both load-bearing:
 *
 *  1. Only names from KNOWN_CLIS are ever executed. Nothing from the request
 *     body reaches a process, so a stolen admin password cannot become remote
 *     code execution here.
 *  2. `execFile` with an argument array, never a shell. No string is
 *     interpolated into a command line, so there is nothing to inject into.
 *
 * On Vercel this finds nothing, which is correct rather than broken: a
 * serverless function cannot see the operator's laptop. The response says so
 * in words so the dashboard can explain itself instead of showing an error.
 */
export async function GET(request: Request) {
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: "Not authorised" }, { status: 401 });
  }

  const hosted = Boolean(process.env.VERCEL);

  const found = await Promise.all(
    KNOWN_CLIS.map(async (cli) => {
      try {
        const { stdout } = await run(cli.command, cli.versionArgs, {
          timeout: 8000,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        });
        return {
          id: cli.id,
          label: cli.label,
          command: cli.command,
          args: cli.args,
          version: stdout.trim().split("\n")[0].slice(0, 120),
          present: true,
        };
      } catch {
        return { id: cli.id, label: cli.label, command: cli.command, present: false };
      }
    }),
  );

  return NextResponse.json({
    hosted,
    note: hosted
      ? "This dashboard is running on Vercel, which cannot see your machine. Run it locally with `npm run dev` to detect your CLIs."
      : "Scanned this machine.",
    detected: found.filter((f) => f.present),
    missing: found.filter((f) => !f.present).map((f) => f.command),
  });
}
