import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/data", () => ({
  upsertInstrument: vi.fn(),
  insertLot: vi.fn(),
  seedTickerQuote: vi.fn(),
  fetchOpenBuyLots: vi.fn(),
  insertRealizedLots: vi.fn(),
  insertAutoCashTransaction: vi.fn(),
  upsertHoldingOverride: vi.fn(),
}));

import * as data from "@/lib/supabase/data";
import {
  validateLotInput,
  commitLot,
  type LotCommitInput,
} from "@/lib/holdings/commit-lot";
import type { HoldingRow } from "@/types/holding";
import type { UserSettings } from "@/types/settings";
import type { OpenBuyLot } from "@/lib/realized";

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

// ── commitLot (data layer mocked) ─────────────────────────────────────────────
const settings = (over: Partial<UserSettings> = {}): UserSettings =>
  ({ costBasisMethod: "fifo", trackCash: true, ...over }) as UserSettings;

const base: LotCommitInput = {
  ticker: "AAPL", name: "Apple", asset_type: "Equity",
  units: 10, currency: "USD", buy_price: 150, buy_date: "2024-01-02",
  buy_fx_rate: 1.3, fees: 5,
};

const row = (): HoldingRow =>
  ({ id: "lot1", dividendYield: null }) as unknown as HoldingRow;

const openLot = (over: Partial<OpenBuyLot> = {}): OpenBuyLot => ({
  id: "b1", tradeDate: "2023-06-01", price: 100, fxRate: 1.3, fees: 0,
  quantity: 20, openQuantity: 20, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(data.upsertInstrument).mockResolvedValue("instr1" as never);
  vi.mocked(data.insertLot).mockResolvedValue(row() as never);
  vi.mocked(data.seedTickerQuote).mockResolvedValue(undefined as never);
  vi.mocked(data.fetchOpenBuyLots).mockResolvedValue([] as never);
  vi.mocked(data.insertRealizedLots).mockResolvedValue(undefined as never);
  vi.mocked(data.insertAutoCashTransaction).mockResolvedValue(undefined as never);
  vi.mocked(data.upsertHoldingOverride).mockResolvedValue(undefined as never);
});

describe("commitLot", () => {
  it("commits a buy and logs a negative auto-cash transaction when tracking cash", async () => {
    const result = await commitLot("u", base, settings());
    expect(result.id).toBe("lot1");
    expect(data.insertAutoCashTransaction).toHaveBeenCalledWith(
      "u", "lot1",
      expect.objectContaining({ type: "buy", amount: -(10 * 150 + 5), currency: "USD" }),
    );
    expect(data.insertRealizedLots).not.toHaveBeenCalled();
  });

  it("does not log cash when trackCash is off", async () => {
    await commitLot("u", base, settings({ trackCash: false }));
    expect(data.insertAutoCashTransaction).not.toHaveBeenCalled();
  });

  it("matches a sell against open lots and inserts realized rows + positive cash", async () => {
    vi.mocked(data.fetchOpenBuyLots).mockResolvedValue([openLot()] as never);
    await commitLot("u", { ...base, transaction_type: "sell" }, settings());
    expect(data.insertRealizedLots).toHaveBeenCalledOnce();
    expect(data.insertAutoCashTransaction).toHaveBeenCalledWith(
      "u", "lot1",
      expect.objectContaining({ type: "sell", amount: 10 * 150 - 5 }),
    );
  });

  it("rejects a specific-method sell that has no lot_allocations", async () => {
    await expect(
      commitLot(
        "u",
        { ...base, transaction_type: "sell", cost_basis_method: "specific" },
        settings(),
      ),
    ).rejects.toThrow(/lot_allocations/i);
  });

  it("persists a dividend override and reflects it on the returned row", async () => {
    const result = await commitLot("u", { ...base, dividend_yield: 3.5 }, settings());
    expect(data.upsertHoldingOverride).toHaveBeenCalledWith("u", "instr1", 3.5);
    expect(result.dividendYield).toBe(3.5);
  });

  it("throws when the instrument upsert fails", async () => {
    vi.mocked(data.upsertInstrument).mockResolvedValue(null as never);
    await expect(commitLot("u", base, settings())).rejects.toThrow(/Insert failed/i);
  });

  it("throws when the lot insert fails", async () => {
    vi.mocked(data.insertLot).mockResolvedValue(null as never);
    await expect(commitLot("u", base, settings())).rejects.toThrow(/Insert failed/i);
  });

  it("maps lot_allocations for a specific-method sell", async () => {
    vi.mocked(data.fetchOpenBuyLots).mockResolvedValue([openLot({ id: "b1", openQuantity: 10 })] as never);
    await commitLot(
      "u",
      { ...base, units: 10, transaction_type: "sell", cost_basis_method: "specific", lot_allocations: [{ buyLotId: "b1", qty: 10 }] },
      settings(),
    );
    expect(data.insertRealizedLots).toHaveBeenCalledOnce();
  });

  it("applies defaults for a minimal buy input", async () => {
    await commitLot(
      "u",
      { ticker: "AAPL", name: "Apple", asset_type: "Equity", units: 2, currency: "USD", buy_price: 100, buy_date: "2024-01-02" },
      settings(),
    );
    expect(data.upsertInstrument).toHaveBeenCalledWith(
      expect.objectContaining({ flag: "🌐", icon: "briefcase", parValue: null, couponRate: null, maturityDate: null }),
    );
    expect(data.insertAutoCashTransaction).toHaveBeenCalledWith(
      "u", "lot1", expect.objectContaining({ amount: -200, fxRate: 1, broker: "", source: "" }),
    );
  });

  it("carries through all optional instrument + lot fields", async () => {
    await commitLot(
      "u",
      {
        ...base, flag: "🇺🇸", icon: "chart", exchange_code: "NASDAQ",
        par_value: 100, coupon_rate: 3, maturity_date: "2030-01-01",
        broker: "IBKR", strategy: "swing", notes: "n", source: "SRS", current_price: 160,
      },
      settings(),
    );
    expect(data.upsertInstrument).toHaveBeenCalledWith(
      expect.objectContaining({
        flag: "🇺🇸", icon: "chart", exchangeCode: "NASDAQ",
        parValue: 100, couponRate: 3, maturityDate: "2030-01-01",
      }),
    );
  });
});
