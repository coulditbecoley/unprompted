/**
 * When the week actually runs.
 *
 * One definition, because there were two and they disagreed. The countdown and
 * the Atom feed both assumed Monday 13:00 UTC, while the scheduled task has
 * always been Monday 13:00 in the operator's own timezone -- 17:00 UTC in
 * summer, 18:00 in winter. The site was telling readers the chart updates four
 * hours before it does, and the feed stamped every week with the wrong hour.
 *
 * Expressed as a zone rather than a fixed offset so it follows daylight saving
 * without an edit twice a year. Keep RUN_ZONE and RUN_HOUR_LOCAL in step with
 * the trigger in scripts/install-weekly-task.ps1, which is what runs the week.
 */

export const RUN_DAY = 1; // Monday
export const RUN_HOUR_LOCAL = 13; // 1pm
export const RUN_ZONE = "America/New_York";

/** How many hours `zone` is ahead of UTC at `instant` (negative for the US). */
function zoneOffsetHours(instant: Date, zone: string): number {
  // Intl is the only DST-correct clock available without a date library, and a
  // date library is not worth adding for one number.
  const asZone = new Date(instant.toLocaleString("en-US", { timeZone: zone }));
  const asUtc = new Date(instant.toLocaleString("en-US", { timeZone: "UTC" }));
  return (asZone.getTime() - asUtc.getTime()) / 3_600_000;
}

/** The UTC instant of the run on the local date `instant` falls on. */
function runInstantOn(instant: Date, zone: string): Date {
  const offset = zoneOffsetHours(instant, zone);
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
      RUN_HOUR_LOCAL - offset,
      0,
      0,
    ),
  );
}

/** The next scheduled run strictly after `now`. */
export function nextRun(now: Date): Date {
  const cursor = new Date(now.getTime());
  for (let i = 0; i < 14; i++) {
    const candidate = runInstantOn(cursor, RUN_ZONE);
    // The weekday is the one in the run's own timezone, not the reader's.
    const localDay = new Date(
      candidate.toLocaleString("en-US", { timeZone: RUN_ZONE }),
    ).getDay();
    if (localDay === RUN_DAY && candidate > now) return candidate;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return runInstantOn(cursor, RUN_ZONE);
}

/** The UTC instant a run dated `runDate` (YYYY-MM-DD) was made. */
export function runInstant(runDate: string): Date {
  const [y, m, d] = runDate.split("-").map(Number);
  return runInstantOn(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), RUN_ZONE);
}
