import { describe, it, expect } from "vitest";
import { sgtDate, isSnapshotStaleForDay } from "@/lib/dates";

describe("sgtDate", () => {
  it("returns the Asia/Singapore calendar date as YYYY-MM-DD", () => {
    // 2026-07-21T20:00:00Z == 2026-07-22 04:00 SGT
    expect(sgtDate(new Date("2026-07-21T20:00:00Z"))).toBe("2026-07-22");
  });

  it("has already rolled to the next SGT day at UTC 16:00", () => {
    // 2026-07-21T16:00:00Z == 2026-07-22 00:00 SGT
    expect(sgtDate(new Date("2026-07-21T16:00:00Z"))).toBe("2026-07-22");
  });

  it("stays on the SGT day for a same-day UTC morning time", () => {
    // 2026-07-22T02:00:00Z == 2026-07-22 10:00 SGT
    expect(sgtDate(new Date("2026-07-22T02:00:00Z"))).toBe("2026-07-22");
  });
});

describe("isSnapshotStaleForDay", () => {
  const now = new Date("2026-07-22T02:00:00Z"); // 2026-07-22 SGT

  it("is not stale when the latest snapshot is today (SGT)", () => {
    expect(isSnapshotStaleForDay("2026-07-22", now)).toBe(false);
  });

  it("is stale when the latest snapshot is a prior day", () => {
    expect(isSnapshotStaleForDay("2026-07-21", now)).toBe(true);
  });

  it("is stale when there are no snapshots", () => {
    expect(isSnapshotStaleForDay(undefined, now)).toBe(true);
  });
});
