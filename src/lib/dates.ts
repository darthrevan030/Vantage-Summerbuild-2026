// Asia/Singapore has no DST, so the offset is a fixed +08:00 year-round.
// en-CA formats a Date as YYYY-MM-DD, which is exactly our snapshot key.
export function sgtDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

// The once-per-day signal: a snapshot already exists for the current SGT day.
export function isSnapshotStaleForDay(
  latestRecordedDate: string | undefined,
  now: Date = new Date(),
): boolean {
  return latestRecordedDate !== sgtDate(now);
}
