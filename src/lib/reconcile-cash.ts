import { fetchCashTransactions, insertLegacyCashSeed } from "@/lib/supabase/data";
import { computeLegacySeedAmount } from "@/lib/contributions";
import type { HoldingRow } from "@/types/holding";

/**
 * One-time backfill for users who have lots but zero cash_transactions even
 * after Task 1's cash_balances migration — i.e. never touched the old cash
 * feature at all. Seeds a single lump deposit from their lifetime cost basis.
 * Idempotent: a no-op once the user has any cash_transactions row, whether
 * from this seed, the cash_balances migration, or their own manual entries.
 */
export async function reconcileCashLedger(
  userId: string,
  trackCash: boolean,
  holdings: HoldingRow[],
): Promise<void> {
  if (!trackCash) return;
  const existing = await fetchCashTransactions(userId);
  if (existing.length > 0) return;
  const seed = computeLegacySeedAmount(holdings);
  if (!seed) return;
  await insertLegacyCashSeed(userId, seed.amountSgd, seed.earliestDate);
}
