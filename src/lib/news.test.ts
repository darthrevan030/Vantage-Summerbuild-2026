import { describe, it, expect } from "vitest";
import {
  tag,
  ago,
  baseTicker,
  toFinnhubSymbol,
  buildNewsQueries,
  extractQueryTokens,
  textRelevance,
  compositeRelevance,
} from "./news";

describe("tag", () => {
  it("detects positive / negative / neutral headlines", () => {
    expect(tag("Shares surge on record profit")).toBe("pos");
    expect(tag("Stock plunges after profit warning")).toBe("neg");
    expect(tag("Company holds annual meeting")).toBe("neu");
  });
});

describe("ago", () => {
  const now = 1_000_000_000_000; // fixed nowMs
  it("formats minutes, hours, days", () => {
    expect(ago(now / 1000 - 120, now)).toBe("2m");
    expect(ago(now / 1000 - 7200, now)).toBe("2h");
    expect(ago(now / 1000 - 2 * 86400, now)).toBe("2d");
  });
});

describe("baseTicker", () => {
  it("strips the exchange suffix", () => {
    expect(baseTicker("VWRA.LSE")).toBe("VWRA");
    expect(baseTicker("AAPL")).toBe("AAPL");
    expect(baseTicker("7203.TSE")).toBe("7203");
  });
});

describe("toFinnhubSymbol", () => {
  it("returns a bare US ticker unchanged", () => {
    expect(toFinnhubSymbol("AAPL")).toBe("AAPL");
  });
  it("maps a known exchange to the Finnhub prefix", () => {
    expect(toFinnhubSymbol("VWRA.LSE")).toBe("LSE:VWRA");
    expect(toFinnhubSymbol("AAPL.US")).toBe("AAPL");
  });
  it("fails closed (null) on an unmapped exchange", () => {
    expect(toFinnhubSymbol("XYZ.NOPE")).toBeNull();
  });
});

describe("extractQueryTokens", () => {
  it("uppercases the ticker and strips corporate suffixes from the name", () => {
    const t = extractQueryTokens("D05.SG", "DBS Group Holdings Ltd");
    expect(t.ticker).toBe("D05");
    expect(t.nameTokens).toContain("dbs");
    expect(t.nameTokens).not.toContain("group");
    expect(t.nameTokens).not.toContain("holdings");
    expect(t.nameTokens).not.toContain("ltd");
  });
  it("drops tokens shorter than 3 chars", () => {
    const t = extractQueryTokens("AA", "AB Co");
    expect(t.nameTokens).toEqual([]);
  });
});

describe("textRelevance", () => {
  const tokens = extractQueryTokens("D05.SG", "DBS Group");
  it("scores a ticker-only hit at W_TICKER (0.6)", () => {
    expect(textRelevance("D05 hits new high on SGX", tokens)).toBeCloseTo(0.6, 6);
  });
  it("scores full name coverage alone at W_NAME (0.4)", () => {
    expect(textRelevance("DBS reports strong quarter", tokens)).toBeCloseTo(0.4, 6);
  });
  it("scores ticker + full name at 1.0", () => {
    expect(textRelevance("DBS (D05) reports strong quarter", tokens)).toBeCloseTo(1.0, 6);
  });
  it("scores an off-topic headline at 0", () => {
    expect(textRelevance("Weather forecast for the weekend", tokens)).toBe(0);
  });
});

describe("compositeRelevance", () => {
  it("uses the max of provider score and text match when provider score is present", () => {
    expect(compositeRelevance(0.2, 0.9)).toBeCloseTo(0.9, 6);
    expect(compositeRelevance(0.8, 0.3)).toBeCloseTo(0.8, 6);
  });
  it("falls back to text match when provider score is absent", () => {
    expect(compositeRelevance(0.55)).toBeCloseTo(0.55, 6);
  });
});

describe("buildNewsQueries", () => {
  it("builds an ETF family query for fund names", () => {
    const q = buildNewsQueries("VWRA.LSE", "Vanguard FTSE All-World UCITS ETF");
    expect(q[0]).toBe('"Vanguard" ETF');
    expect(q).toContain('"VWRA" ETF');
  });
  it("builds a stripped-name + finance-context query for equities", () => {
    const q = buildNewsQueries("D05.SG", "DBS Group Holdings Ltd");
    expect(q[0]).toContain("DBS");
    expect(q[0]).toContain("stock OR shares OR earnings OR investor");
  });
  it("falls back to ticker-only when no name is given", () => {
    const q = buildNewsQueries("AAPL");
    expect(q[q.length - 1]).toBe('"AAPL"');
  });
});
