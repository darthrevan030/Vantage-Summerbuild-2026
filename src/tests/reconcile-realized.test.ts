import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/data", () => ({
  fetchUnmatchedSellLots: vi.fn(),
  fetchOpenBuyLots: vi.fn(),
  insertRealizedLots: vi.fn(),
}));

import {
  fetchUnmatchedSellLots,
  fetchOpenBuyLots,
  insertRealizedLots,
} from "@/lib/supabase/data";
import { reconcileRealizedLots } from "@/lib/reconcile-realized";
import type { OpenBuyLot } from "@/lib/realized";

const mSells = vi.mocked(fetchUnmatchedSellLots);
const mOpen = vi.mocked(fetchOpenBuyLots);
const mInsert = vi.mocked(insertRealizedLots);

interface UnmatchedSell {
  id: string;
  instrumentId: string;
  ticker: string;
  tradeDate: string;
  quantity: number;
  price: number;
  fxRate: number;
  fees: number;
}

function sell(over: Partial<UnmatchedSell> = {}): UnmatchedSell {
  return {
    id: "s1", instrumentId: "i1", ticker: "AAPL", tradeDate: "2025-01-10",
    quantity: 10, price: 200, fxRate: 1.3, fees: 0, ...over,
  };
}

function buyLot(over: Partial<OpenBuyLot> = {}): OpenBuyLot {
  return {
    id: "b1", tradeDate: "2025-01-01", price: 100, fxRate: 1.3, fees: 0,
    quantity: 10, openQuantity: 10, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mInsert.mockResolvedValue(undefined as never);
});

describe("reconcileRealizedLots", () => {
  it("matches a fully-covered sell and inserts realized rows", async () => {
    mSells.mockResolvedValue([sell({ quantity: 10 })] as never);
    mOpen.mockResolvedValue([buyLot({ openQuantity: 20 })] as never);
    const res = await reconcileRealizedLots("u", "fifo");
    expect(res.reconciled).toBe(1);
    expect(res.warnings).toEqual([]);
    expect(mInsert).toHaveBeenCalledOnce();
  });

  it("warns and partially matches when the sell exceeds open quantity", async () => {
    mSells.mockResolvedValue([sell({ quantity: 10 })] as never);
    mOpen.mockResolvedValue([buyLot({ openQuantity: 4 })] as never);
    const res = await reconcileRealizedLots("u", "average");
    expect(res.reconciled).toBe(1);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/exceeds open buy quantity/i);
  });

  it("warns and skips a sell with no open lots", async () => {
    mSells.mockResolvedValue([sell({ quantity: 5 })] as never);
    mOpen.mockResolvedValue([] as never);
    const res = await reconcileRealizedLots("u", "fifo");
    expect(res.reconciled).toBe(0);
    expect(res.warnings).toHaveLength(1);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it("falls back to FIFO when the stored method is 'specific'", async () => {
    mSells.mockResolvedValue([sell({ quantity: 10 })] as never);
    mOpen.mockResolvedValue([buyLot({ openQuantity: 20 })] as never);
    const res = await reconcileRealizedLots("u", "specific");
    expect(res.reconciled).toBe(1);
    expect(mInsert).toHaveBeenCalledWith(
      "u", "i1", "s1", "fifo", "2025-01-10", 200, 1.3, expect.any(Array),
    );
  });

  it("names the instrument id in the warning when the ticker is empty", async () => {
    mSells.mockResolvedValue([sell({ ticker: "", instrumentId: "i9", quantity: 10 })] as never);
    mOpen.mockResolvedValue([buyLot({ openQuantity: 3 })] as never);
    const res = await reconcileRealizedLots("u", "fifo");
    expect(res.warnings[0]).toMatch(/i9/);
  });
});
