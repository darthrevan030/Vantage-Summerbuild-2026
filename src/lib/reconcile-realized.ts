import {
  fetchUnmatchedSellLots,
  fetchOpenBuyLots,
  insertRealizedLots,
} from "@/lib/supabase/data";
import { matchSell, type SellLot } from "@/lib/realized";
import type { CostBasisMethod } from "@/types/settings";

/**
 * Backfills realized_lots for sells that predate this feature (or were left
 * unmatched by an earlier partial run). Idempotent — a sell already carrying
 * realized_lots rows is skipped, so calling this on every dashboard load is
 * cheap after the first real run. Processes sells sequentially and in
 * trade_date order per instrument's cross-cutting timeline so each sell's
 * freshly-inserted matches are accounted for before the next sell's open
 * quantity is computed.
 */
export async function reconcileRealizedLots(
  userId: string,
  method: CostBasisMethod,
): Promise<{ reconciled: number; warnings: string[] }> {
  // "specific" (manual-lot) allocation has no historical data to replay for a
  // backfill — there's no way to know which lots a user would have picked for
  // a sell that predates this feature. Fall back to FIFO, a deterministic
  // default, whenever the stored method is "specific"; fifo/average pass through.
  const backfillMethod: CostBasisMethod =
    method === "specific" ? "fifo" : method;

  const unmatchedSells = await fetchUnmatchedSellLots(userId);
  let reconciled = 0;
  const warnings: string[] = [];

  for (const sell of unmatchedSells) {
    const openBuyLots = await fetchOpenBuyLots(userId, sell.instrumentId);
    const totalOpen = openBuyLots.reduce((s, l) => s + l.openQuantity, 0);

    let sellLot: SellLot = {
      quantity: sell.quantity,
      price: sell.price,
      fxRate: sell.fxRate,
      fees: sell.fees,
    };

    if (totalOpen + 1e-9 < sell.quantity) {
      warnings.push(
        `${sell.ticker || sell.instrumentId}: sell of ${sell.quantity} on ${sell.tradeDate} exceeds open buy quantity (${totalOpen}); matched ${totalOpen} and left the rest unmatched`,
      );
      if (totalOpen <= 1e-9) continue;
      sellLot = { ...sellLot, quantity: totalOpen };
    }

    const matches = matchSell(sellLot, openBuyLots, backfillMethod);
    if (matches.length > 0) {
      await insertRealizedLots(
        userId,
        sell.instrumentId,
        sell.id,
        backfillMethod,
        sell.tradeDate,
        sell.price,
        sell.fxRate,
        matches,
      );
      reconciled++;
    }
  }

  return { reconciled, warnings };
}
