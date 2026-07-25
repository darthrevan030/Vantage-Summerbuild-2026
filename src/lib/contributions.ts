import type { CashTransaction } from "@/types/cash";
import type { HoldingRow } from "@/types/holding";
import { computeCostBasisSGD } from "./fx";

const CONTRIBUTION_TYPES = new Set(["deposit", "withdrawal"]);

// amount is signed (+in, -out); summing it directly for deposit/withdrawal
// gives the net external capital contributed — transfers, fees, dividend
// cash, and buy/sell (internal asset<->cash swaps) are deliberately excluded.
export function computeNetContributions(
  transactions: CashTransaction[],
  asOfDate?: string,
): number {
  return transactions
    .filter((t) => CONTRIBUTION_TYPES.has(t.type))
    .filter((t) => !asOfDate || t.date <= asOfDate)
    .reduce((s, t) => s + t.amount * t.fxRate, 0);
}

export interface LegacySeed {
  amountSgd: number;
  earliestDate: string;
}

export function computeLegacySeedAmount(holdings: HoldingRow[]): LegacySeed | null {
  const buyLots = holdings.filter((h) => h.transactionType === "buy");
  if (buyLots.length === 0) return null;
  const amountSgd = buyLots.reduce((s, h) => s + computeCostBasisSGD(h), 0);
  const earliestDate = buyLots.reduce(
    (min, h) => (h.buyDate < min ? h.buyDate : min),
    buyLots[0].buyDate,
  );
  return { amountSgd, earliestDate };
}
