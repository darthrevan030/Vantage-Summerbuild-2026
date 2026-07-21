import type { CostBasisMethod } from "@/types/settings";

export interface OpenBuyLot {
  id: string;
  tradeDate: string;
  price: number;
  fxRate: number;
  fees: number;
  quantity: number;
  openQuantity: number;
}

export interface SellLot {
  quantity: number;
  price: number;
  fxRate: number;
  fees: number;
}

export interface ManualAllocation {
  buyLotId: string;
  quantity: number;
}

export interface LotMatch {
  buyLotId: string;
  matchedQuantity: number;
  matchedBuyPrice: number;
  matchedBuyFx: number;
  assetGainSgd: number;
  fxGainSgd: number;
}

export class InsufficientOpenQuantityError extends Error {}
export class InvalidAllocationError extends Error {}

const EPS = 1e-9;

/**
 * Match a sell against open buy lots under FIFO / average / specific-lot,
 * then compute each match's fee-aware asset/FX gain. Fees are valued in SGD
 * at their own transaction's FX rate and folded entirely into assetGainSgd —
 * a fee is a fixed historical outlay, not something with FX exposure to
 * decompose. Written once at sell-commit time; callers persist the result
 * verbatim (see reconcile-realized.ts / the API routes).
 */
export function matchSell(
  sellLot: SellLot,
  openBuyLots: OpenBuyLot[],
  method: CostBasisMethod,
  manualAllocations?: ManualAllocation[],
): LotMatch[] {
  const available = openBuyLots.filter((l) => l.openQuantity > EPS);
  let allocations: { lot: OpenBuyLot; qty: number }[];

  if (method === "specific") {
    if (!manualAllocations || manualAllocations.length === 0) {
      throw new InvalidAllocationError(
        "specific-lot method requires manualAllocations",
      );
    }
    const byId = new Map(available.map((l) => [l.id, l]));
    const cumulativeByLotId = new Map<string, number>();
    allocations = manualAllocations.map((a) => {
      const lot = byId.get(a.buyLotId);
      if (!lot) {
        throw new InvalidAllocationError(`buy lot ${a.buyLotId} is not open`);
      }
      if (!Number.isFinite(a.quantity)) {
        throw new InvalidAllocationError("allocation quantity must be finite");
      }
      if (a.quantity <= 0) {
        throw new InvalidAllocationError("allocation quantity must be positive");
      }
      const priorForLot = cumulativeByLotId.get(a.buyLotId) ?? 0;
      const cumulativeForLot = priorForLot + a.quantity;
      if (cumulativeForLot > lot.openQuantity + EPS) {
        throw new InvalidAllocationError(
          `allocation exceeds open quantity for lot ${a.buyLotId}`,
        );
      }
      cumulativeByLotId.set(a.buyLotId, cumulativeForLot);
      return { lot, qty: a.quantity };
    });
    const allocatedTotal = allocations.reduce((s, a) => s + a.qty, 0);
    if (Math.abs(allocatedTotal - sellLot.quantity) > 1e-6) {
      throw new InvalidAllocationError(
        "allocations must sum to the sell quantity",
      );
    }
  } else {
    const totalOpen = available.reduce((s, l) => s + l.openQuantity, 0);
    if (totalOpen + EPS < sellLot.quantity) {
      throw new InsufficientOpenQuantityError(
        `only ${totalOpen} units open, cannot sell ${sellLot.quantity}`,
      );
    }
    if (method === "fifo") {
      const sorted = [...available].sort((a, b) =>
        a.tradeDate.localeCompare(b.tradeDate),
      );
      allocations = [];
      let remaining = sellLot.quantity;
      for (const lot of sorted) {
        if (remaining <= EPS) break;
        const take = Math.min(lot.openQuantity, remaining);
        allocations.push({ lot, qty: take });
        remaining -= take;
      }
    } else {
      allocations = available
        .map((lot) => ({
          lot,
          qty: (lot.openQuantity / totalOpen) * sellLot.quantity,
        }))
        .filter((a) => a.qty > EPS);
    }
    // Floating-point division in the "average" branch (and, rarely, the
    // running-remainder subtraction in "fifo") can leave a tiny residual —
    // absorb it into the last allocation so the total is exact.
    const allocatedTotal = allocations.reduce((s, a) => s + a.qty, 0);
    const diff = sellLot.quantity - allocatedTotal;
    if (Math.abs(diff) > EPS && allocations.length > 0) {
      allocations[allocations.length - 1].qty += diff;
    }
  }

  return allocations.map(({ lot, qty }) => {
    const buyFeeAlloc = lot.fees * (qty / lot.quantity);
    const sellFeeAlloc = sellLot.fees * (qty / sellLot.quantity);
    const assetGainSgd =
      qty * (sellLot.price - lot.price) * sellLot.fxRate -
      sellFeeAlloc * sellLot.fxRate -
      buyFeeAlloc * lot.fxRate;
    const fxGainSgd = qty * lot.price * (sellLot.fxRate - lot.fxRate);
    return {
      buyLotId: lot.id,
      matchedQuantity: qty,
      matchedBuyPrice: lot.price,
      matchedBuyFx: lot.fxRate,
      assetGainSgd,
      fxGainSgd,
    };
  });
}
