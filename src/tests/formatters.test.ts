import { describe, it, expect } from "vitest";
import {
  NF,
  pct,
  rate,
  ccyFmt,
  ccySigned,
  CCY_SYMBOL,
  CCY_FLAG,
  SUPPORTED_CURRENCIES,
} from "@/lib/formatters";

describe("NF", () => {
  it("formats a positive integer with grouping and no decimals by default", () => {
    expect(NF(1234)).toBe("1,234");
  });

  it("formats with the requested number of decimal places", () => {
    expect(NF(1234.5, 2)).toBe("1,234.50");
  });

  it("takes the absolute value, dropping any sign", () => {
    expect(NF(-1234)).toBe("1,234");
  });

  it("formats zero", () => {
    expect(NF(0)).toBe("0");
  });
});

describe("pct", () => {
  it("prefixes a non-negative value with +", () => {
    expect(pct(12.345)).toBe("+12.35%");
  });

  it("prefixes a negative value with − (unicode minus)", () => {
    expect(pct(-12.345)).toBe("−12.35%");
  });

  it("treats zero as non-negative", () => {
    expect(pct(0)).toBe("+0.00%");
  });

  it("respects a custom decimal count", () => {
    expect(pct(12.345, 0)).toBe("+12%");
  });
});

describe("rate", () => {
  it("formats to 4 decimal places", () => {
    expect(rate(1.3)).toBe("1.3000");
  });

  it("takes the absolute value", () => {
    expect(rate(-1.3)).toBe("1.3000");
  });
});

describe("ccyFmt", () => {
  it("uses the known symbol for a supported currency", () => {
    expect(ccyFmt(1000, "USD")).toBe("US$1,000");
  });

  it("uses SGD's symbol", () => {
    expect(ccyFmt(1000, "SGD")).toBe("S$1,000");
  });

  it("falls back to 'CODE ' for an unknown currency", () => {
    expect(ccyFmt(1000, "XYZ")).toBe("XYZ 1,000");
  });

  it("respects a custom decimal count", () => {
    expect(ccyFmt(1000.5, "USD", 2)).toBe("US$1,000.50");
  });

  it("drops the sign of a negative amount (no sign handling)", () => {
    expect(ccyFmt(-1000, "USD")).toBe("US$1,000");
  });
});

describe("ccySigned", () => {
  it("prefixes a positive amount with +", () => {
    expect(ccySigned(1000, "USD")).toBe("+US$1,000");
  });

  it("prefixes a negative amount with − (unicode minus)", () => {
    expect(ccySigned(-1000, "USD")).toBe("−US$1,000");
  });

  it("treats zero as non-negative", () => {
    expect(ccySigned(0, "USD")).toBe("+US$0");
  });

  it("falls back to 'CODE ' for an unknown currency", () => {
    expect(ccySigned(500, "XYZ")).toBe("+XYZ 500");
  });
});

describe("CCY_SYMBOL", () => {
  it("has an entry for every supported currency", () => {
    for (const ccy of SUPPORTED_CURRENCIES) {
      expect(CCY_SYMBOL[ccy]).toBeDefined();
    }
  });
});

describe("CCY_FLAG", () => {
  it("has an entry for every supported currency", () => {
    for (const ccy of SUPPORTED_CURRENCIES) {
      expect(CCY_FLAG[ccy]).toBeDefined();
    }
  });
});

describe("SUPPORTED_CURRENCIES", () => {
  it("lists the 8 supported currencies", () => {
    expect(SUPPORTED_CURRENCIES).toEqual([
      "SGD",
      "USD",
      "EUR",
      "GBP",
      "AUD",
      "JPY",
      "INR",
      "HKD",
    ]);
  });
});
