import { describe, it, expect } from "vitest";
import { validateLotInput } from "@/lib/holdings/commit-lot";

const ok = {
  ticker: "AAPL",
  name: "Apple",
  asset_type: "Equity",
  units: 10,
  currency: "USD",
  buy_price: 150,
  buy_date: "2024-01-02",
};

describe("validateLotInput", () => {
  it("accepts a well-formed buy", () => {
    expect(validateLotInput(ok)).toBeNull();
  });
  it("rejects a bad ticker format", () => {
    expect(validateLotInput({ ...ok, ticker: "has space" })).toMatch(/ticker/i);
  });
  it("rejects a bad date format", () => {
    expect(validateLotInput({ ...ok, buy_date: "02/01/2024" })).toMatch(/date/i);
  });
  it("rejects negative units", () => {
    // 0 is falsy → caught by the required-fields guard; use a negative to reach
    // the numeric units check (mirrors the original POST guard order).
    expect(validateLotInput({ ...ok, units: -5 })).toMatch(/units/i);
  });
  it("rejects a missing required field", () => {
    expect(validateLotInput({ ...ok, name: "" })).toMatch(/required/i);
  });
  it("rejects an invalid transaction_type", () => {
    expect(
      validateLotInput({ ...ok, transaction_type: "gift" as never }),
    ).toMatch(/transaction_type/i);
  });
});
