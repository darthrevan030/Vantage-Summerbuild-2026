import { describe, it, expect } from "vitest";
import {
  matchSell,
  InsufficientOpenQuantityError,
  InvalidAllocationError,
  type OpenBuyLot,
} from "./realized";

const b1: OpenBuyLot = {
  id: "b1",
  tradeDate: "2026-01-01",
  price: 100,
  fxRate: 1.3,
  fees: 10,
  quantity: 10,
  openQuantity: 10,
};
const b2: OpenBuyLot = {
  id: "b2",
  tradeDate: "2026-02-01",
  price: 110,
  fxRate: 1.32,
  fees: 0,
  quantity: 20,
  openQuantity: 20,
};
const sell = { quantity: 15, price: 130, fxRate: 1.35, fees: 5 };

describe("matchSell — fifo", () => {
  it("consumes the oldest lot first, then the next, with fee-aware gains", () => {
    const matches = matchSell(sell, [b1, b2], "fifo");
    expect(matches).toHaveLength(2);
    const m1 = matches.find((m) => m.buyLotId === "b1")!;
    const m2 = matches.find((m) => m.buyLotId === "b2")!;
    expect(m1.matchedQuantity).toBeCloseTo(10, 6);
    expect(m2.matchedQuantity).toBeCloseTo(5, 6);
    expect(m1.assetGainSgd).toBeCloseTo(387.5, 6);
    expect(m1.fxGainSgd).toBeCloseTo(50, 6);
    expect(m2.assetGainSgd).toBeCloseTo(132.75, 6);
    expect(m2.fxGainSgd).toBeCloseTo(16.5, 6);
  });

  it("total realized gain across matches equals proceeds minus cost basis", () => {
    const matches = matchSell(sell, [b1, b2], "fifo");
    const totalGain = matches.reduce((s, m) => s + m.assetGainSgd + m.fxGainSgd, 0);
    const proceeds = sell.quantity * sell.price * sell.fxRate - sell.fees * sell.fxRate;
    const costBasis = matches.reduce((s, m) => {
      const lot = [b1, b2].find((l) => l.id === m.buyLotId)!;
      const buyFeeAlloc = lot.fees * (m.matchedQuantity / lot.quantity);
      return s + m.matchedQuantity * m.matchedBuyPrice * m.matchedBuyFx + buyFeeAlloc * lot.fxRate;
    }, 0);
    expect(totalGain).toBeCloseTo(proceeds - costBasis, 6);
  });

  it("throws InsufficientOpenQuantityError when overselling", () => {
    expect(() => matchSell({ ...sell, quantity: 31 }, [b1, b2], "fifo")).toThrow(
      InsufficientOpenQuantityError,
    );
  });
});

describe("matchSell — average", () => {
  it("pro-rates quantity across all open lots by remaining open quantity", () => {
    const matches = matchSell(sell, [b1, b2], "average");
    expect(matches).toHaveLength(2);
    const m1 = matches.find((m) => m.buyLotId === "b1")!;
    const m2 = matches.find((m) => m.buyLotId === "b2")!;
    expect(m1.matchedQuantity).toBeCloseTo(5, 6);
    expect(m2.matchedQuantity).toBeCloseTo(10, 6);
    expect(m1.matchedQuantity + m2.matchedQuantity).toBeCloseTo(sell.quantity, 9);
  });
});

describe("matchSell — specific", () => {
  it("uses the caller's manual allocation verbatim", () => {
    const matches = matchSell(sell, [b1, b2], "specific", [
      { buyLotId: "b1", quantity: 7 },
      { buyLotId: "b2", quantity: 8 },
    ]);
    expect(matches.find((m) => m.buyLotId === "b1")!.matchedQuantity).toBeCloseTo(7, 6);
    expect(matches.find((m) => m.buyLotId === "b2")!.matchedQuantity).toBeCloseTo(8, 6);
  });

  it("throws InvalidAllocationError when allocations don't sum to the sell quantity", () => {
    expect(() =>
      matchSell(sell, [b1, b2], "specific", [
        { buyLotId: "b1", quantity: 7 },
        { buyLotId: "b2", quantity: 1 },
      ]),
    ).toThrow(InvalidAllocationError);
  });

  it("throws InvalidAllocationError when an allocation exceeds a lot's open quantity", () => {
    expect(() =>
      matchSell({ ...sell, quantity: 10 }, [b1, b2], "specific", [
        { buyLotId: "b1", quantity: 11 },
      ]),
    ).toThrow(InvalidAllocationError);
  });

  it("throws InvalidAllocationError when no allocations are supplied", () => {
    expect(() => matchSell(sell, [b1, b2], "specific")).toThrow(InvalidAllocationError);
  });
});
