import {
  upsertInstrument,
  insertLot,
  seedTickerQuote,
  fetchOpenBuyLots,
  insertRealizedLots,
  insertAutoCashTransaction,
  upsertHoldingOverride,
} from "@/lib/supabase/data";
import { matchSell, type ManualAllocation } from "@/lib/realized";
import type { CostBasisMethod, UserSettings } from "@/types/settings";
import type { HoldingRow } from "@/types/holding";

const TICKER_RE = /^[A-Za-z0-9.\-:]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;

const finiteNonNeg = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= NUM_MAX;
};

export interface LotCommitInput {
  ticker: string;
  name: string;
  asset_type: string;
  broker?: string;
  strategy?: string;
  units: number | string;
  currency: string;
  flag?: string;
  icon?: string;
  buy_price: number | string;
  buy_date: string;
  buy_fx_rate?: number | string;
  current_price?: number | string;
  current_fx_rate?: number | string;
  spark_data?: number[];
  exchange_code?: string | null;
  source?: string;
  fees?: number | string;
  transaction_type?: "buy" | "sell";
  notes?: string | null;
  maturity_date?: string | null;
  par_value?: number | string | null;
  coupon_rate?: number | string | null;
  dividend_yield?: number | string | null;
  lot_allocations?: { buyLotId: string; qty: number }[];
  cost_basis_method?: CostBasisMethod;
}

/** Format/numeric guards. Returns an error message, or null when valid. */
export function validateLotInput(b: LotCommitInput): string | null {
  if (b.ticker && !TICKER_RE.test(String(b.ticker))) return "invalid ticker format";
  if (b.name && String(b.name).length > 200) return "name too long";
  if (b.notes != null && String(b.notes).length > 2000) return "notes too long";
  if (b.buy_date && !DATE_RE.test(String(b.buy_date))) return "invalid buy_date format";
  if (!b.ticker || !b.name || !b.asset_type || !b.buy_price || !b.buy_date || !b.units || !b.currency)
    return "Missing required fields";
  if (!finiteNonNeg(b.units) || Number(b.units) <= 0) return "invalid units";
  if (!finiteNonNeg(b.buy_price)) return "invalid buy_price";
  if (b.buy_fx_rate !== undefined && !finiteNonNeg(b.buy_fx_rate)) return "invalid buy_fx_rate";
  if (b.current_price !== undefined && !finiteNonNeg(b.current_price)) return "invalid current_price";
  if (b.current_fx_rate !== undefined && !finiteNonNeg(b.current_fx_rate)) return "invalid current_fx_rate";
  if (Array.isArray(b.spark_data) && b.spark_data.length > 400) return "spark_data too large";
  if (b.source !== undefined && !["CPF", "SRS", "Cash", ""].includes(String(b.source))) return "invalid source";
  if (b.transaction_type !== undefined && !["buy", "sell"].includes(String(b.transaction_type)))
    return "invalid transaction_type";
  if (b.fees !== undefined && !finiteNonNeg(b.fees)) return "invalid fees";
  if (b.maturity_date != null && !DATE_RE.test(String(b.maturity_date))) return "invalid maturity_date";
  if (b.par_value != null && !finiteNonNeg(b.par_value)) return "invalid par_value";
  if (b.coupon_rate != null && !finiteNonNeg(b.coupon_rate)) return "invalid coupon_rate";
  if (b.dividend_yield != null && !finiteNonNeg(b.dividend_yield)) return "invalid dividend_yield";
  if (b.cost_basis_method !== undefined && !["fifo", "average", "specific"].includes(String(b.cost_basis_method)))
    return "invalid cost_basis_method";
  return null;
}

/**
 * Land one transaction leg: upsert the shared instrument, match a sell against
 * open buy lots, seed a quote, insert the lot, then persist realized rows +
 * auto-cash + dividend override. Assumes `input` already passed
 * `validateLotInput`. Propagates matchSell's typed errors, or throws
 * Error("Insert failed") on a DB write failure.
 */
export async function commitLot(
  userId: string,
  input: LotCommitInput,
  userSettings: UserSettings,
): Promise<HoldingRow> {
  const instrumentId = await upsertInstrument({
    symbol: String(input.ticker),
    exchangeCode: input.exchange_code ? String(input.exchange_code) : null,
    assetType: String(input.asset_type),
    currency: String(input.currency),
    name: String(input.name),
    flag: String(input.flag ?? "🌐"),
    icon: String(input.icon ?? "briefcase"),
    parValue: input.par_value != null ? Number(input.par_value) : null,
    couponRate: input.coupon_rate != null ? Number(input.coupon_rate) : null,
    maturityDate: input.maturity_date ? String(input.maturity_date) : null,
  });
  if (!instrumentId) throw new Error("Insert failed");

  let sellMatches: ReturnType<typeof matchSell> | undefined;
  let sellMethod: CostBasisMethod | undefined;
  if (input.transaction_type === "sell") {
    sellMethod = input.cost_basis_method ?? userSettings.costBasisMethod;
    let manualAllocations: ManualAllocation[] | undefined;
    if (sellMethod === "specific") {
      if (!Array.isArray(input.lot_allocations) || input.lot_allocations.length === 0)
        throw new Error("specific cost-basis method requires lot_allocations");
      manualAllocations = input.lot_allocations.map((a) => ({
        buyLotId: String(a.buyLotId),
        quantity: Number(a.qty),
      }));
    }
    const openBuyLots = await fetchOpenBuyLots(userId, instrumentId);
    sellMatches = matchSell(
      {
        quantity: Number(input.units),
        price: Number(input.buy_price),
        fxRate: Number(input.buy_fx_rate ?? 1),
        fees: input.fees != null ? Number(input.fees) : 0,
      },
      openBuyLots,
      sellMethod,
      manualAllocations,
    );
  }

  await seedTickerQuote(
    String(input.ticker),
    Number(input.current_price ?? input.buy_price),
    Array.isArray(input.spark_data) ? input.spark_data : undefined,
  );

  const row = await insertLot(userId, instrumentId, {
    transactionType: input.transaction_type === "sell" ? "sell" : "buy",
    quantity: Number(input.units),
    price: Number(input.buy_price),
    tradeDate: String(input.buy_date),
    fxRate: Number(input.buy_fx_rate ?? 1),
    fees: input.fees != null ? Number(input.fees) : 0,
    source: input.source != null ? String(input.source) : "",
    broker: String(input.broker ?? ""),
    strategy: String(input.strategy ?? "long_term"),
    notes: input.notes ? String(input.notes) : null,
  });
  if (!row) throw new Error("Insert failed");

  if (input.transaction_type === "sell" && sellMatches && sellMethod) {
    await insertRealizedLots(
      userId,
      instrumentId,
      row.id,
      sellMethod,
      String(input.buy_date),
      Number(input.buy_price),
      Number(input.buy_fx_rate ?? 1),
      sellMatches,
    );
  }

  if (userSettings.trackCash) {
    const grossAmount = Number(input.units) * Number(input.buy_price);
    const feeAmount = input.fees != null ? Number(input.fees) : 0;
    const cashAmount =
      input.transaction_type === "sell" ? grossAmount - feeAmount : -(grossAmount + feeAmount);
    await insertAutoCashTransaction(userId, row.id, {
      date: String(input.buy_date),
      type: input.transaction_type === "sell" ? "sell" : "buy",
      currency: String(input.currency),
      amount: cashAmount,
      fxRate: Number(input.buy_fx_rate ?? 1),
      broker: String(input.broker ?? ""),
      source: input.source != null ? String(input.source) : "",
    });
  }

  if (input.dividend_yield != null) {
    await upsertHoldingOverride(userId, instrumentId, Number(input.dividend_yield));
    row.dividendYield = Number(input.dividend_yield);
  }

  return row;
}
