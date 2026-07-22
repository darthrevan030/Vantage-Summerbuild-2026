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
import {
  normalizeUrl,
  titleTokens,
  jaccard,
  dedupe,
  normalizeFinnhub,
  normalizeAlphaVantage,
  normalizeNewsApi,
  mergeAndRank,
  type Scored,
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

function scored(overrides: Partial<Scored> = {}): Scored {
  return {
    t: "headline",
    src: "Reuters",
    sent: "neu",
    ago: "1h",
    url: "",
    ts: 1000,
    summary: "headline",
    provider: "finnhub",
    rel: 0.5,
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("lowercases host+path, strips trailing slash and query", () => {
    expect(normalizeUrl("https://Reuters.com/Article/123?utm_source=x")).toBe(
      "reuters.com/article/123",
    );
    expect(normalizeUrl("https://reuters.com/article/123/")).toBe(
      "reuters.com/article/123",
    );
  });
  it("returns empty string for empty input", () => {
    expect(normalizeUrl("")).toBe("");
  });
});

describe("jaccard", () => {
  it("computes token overlap", () => {
    expect(jaccard(titleTokens("DBS profit rises"), titleTokens("DBS profit rises"))).toBe(1);
    expect(jaccard(titleTokens("a b c d"), titleTokens("a b c e"))).toBeCloseTo(3 / 5, 6);
  });
});

describe("dedupe", () => {
  it("collapses same-URL items, keeping the higher relevance", () => {
    const out = dedupe([
      scored({ url: "https://x.com/a?utm=1", rel: 0.4 }),
      scored({ url: "https://x.com/a", rel: 0.9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rel).toBe(0.9);
  });
  it("collapses near-duplicate titles above the Jaccard threshold", () => {
    const out = dedupe([
      scored({ t: "DBS profit rises on strong quarter", ts: 1, rel: 0.5 }),
      scored({ t: "DBS profit rises on strong quarter", ts: 2, rel: 0.5 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(2); // ties broken by recency
  });
});

describe("normalizeFinnhub", () => {
  it("maps raw Finnhub items into RawItem", () => {
    const out = normalizeFinnhub(
      [{ headline: "DBS beats estimates", summary: "strong", source: "Reuters News", url: "https://r.com/1", datetime: 900 }],
      1_000_000,
    );
    expect(out[0]).toMatchObject({ t: "DBS beats estimates", url: "https://r.com/1", provider: "finnhub" });
    expect(out[0].summary).toContain("strong");
  });
  it("returns [] for non-array input", () => {
    expect(normalizeAlphaVantage(undefined, "X")).toEqual([]);
    expect(normalizeNewsApi(null)).toEqual([]);
    expect(normalizeFinnhub(null)).toEqual([]);
  });
});

describe("normalizeAlphaVantage", () => {
  it("extracts providerRel for the matching ticker", () => {
    const out = normalizeAlphaVantage(
      [{
        title: "DBS update",
        summary: "s",
        source: "AV",
        url: "https://a.com/1",
        time_published: "20260115T143000",
        overall_sentiment_label: "Bullish",
        ticker_sentiment: [
          { ticker: "D05", relevance_score: "0.82" },
          { ticker: "OTHER", relevance_score: "0.99" },
        ],
      }],
      "D05",
    );
    expect(out[0].providerRel).toBeCloseTo(0.82, 6);
    expect(out[0].sent).toBe("pos");
  });
});

describe("mergeAndRank", () => {
  it("scores, filters below floor, ranks, and caps at MAX_ITEMS", () => {
    const raw = [
      { t: "DBS profit rises", src: "R", sent: "pos" as const, ago: "1h", url: "https://x/1", ts: 3, summary: "DBS profit rises", provider: "finnhub" as const },
      { t: "Totally unrelated weather", src: "R", sent: "neu" as const, ago: "2h", url: "https://x/2", ts: 2, summary: "Totally unrelated weather", provider: "finnhub" as const },
    ];
    const out = mergeAndRank(raw, "D05.SG", "DBS Group");
    expect(out.map((i) => i.t)).toEqual(["DBS profit rises"]); // weather dropped below floor
    expect(out[0]).not.toHaveProperty("rel"); // stripped to NewsItem
  });
  it("returns [] when nothing clears the floor", () => {
    const raw = [
      { t: "weather report", src: "R", sent: "neu" as const, ago: "1h", url: "", ts: 1, summary: "weather report", provider: "newsapi" as const },
    ];
    expect(mergeAndRank(raw, "D05.SG", "DBS Group")).toEqual([]);
  });
});
