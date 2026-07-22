import type { SnapshotRow } from "@/lib/supabase/data";
import type { CashTransaction } from "@/types/cash";

const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export function computeTotalValueSeries(
  snapshots: SnapshotRow[],
  cashTransactions: CashTransaction[],
): { date: string; value: number; cost: number }[] {
  const byDate = new Map<string, SnapshotRow>();
  for (const s of snapshots) byDate.set(s.recordedDate, s);

  const sortedTx = [...cashTransactions].sort((a, b) => a.date.localeCompare(b.date));

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => {
      const cashBalance = sortedTx
        .filter((t) => t.date <= date)
        .reduce((sum, t) => sum + t.amount * t.fxRate, 0);
      return {
        date,
        value: Math.round(s.valueSgd + cashBalance),
        cost: Math.round(s.costSgd),
      };
    });
}

// Splits the value series into consecutive-day sub-periods, backing out any
// net external flow on the LATER day of each sub-period before computing the
// return — a deposit/withdrawal on that day is capital moving, not gain/loss.
// With no flows, r reduces exactly to the naive value[i]/value[i-1]-1.
//
// The value series only has points on dates where a snapshot exists, but a
// flow can land on any date in between. A flow is therefore rolled forward
// to the FIRST sub-period whose ending snapshot date is >= the flow's date
// — that's the first point in the series that actually reflects the flow's
// cash (see computeTotalValueSeries's `t.date <= snapshotDate` overlay).
// Flows on-or-before the very first series date are already baked into that
// starting value and don't affect any sub-period return. Flows after the
// last series date have no sub-period to attribute to and are dropped.
export function computeFlowAdjustedReturns(
  series: { date: string; value: number }[],
  flows: { date: string; amountSgd: number }[],
): { date: string; r: number }[] {
  const flowsByDate = new Map<string, number>();
  if (series.length > 0) {
    const firstDate = series[0].date;
    for (const f of flows) {
      if (f.date <= firstDate) continue;
      let bucketDate: string | undefined;
      for (let i = 1; i < series.length; i++) {
        if (series[i].date >= f.date) {
          bucketDate = series[i].date;
          break;
        }
      }
      if (bucketDate === undefined) continue;
      flowsByDate.set(bucketDate, (flowsByDate.get(bucketDate) ?? 0) + f.amountSgd);
    }
  }
  const out: { date: string; r: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    if (prev <= 0) continue;
    const flow = flowsByDate.get(series[i].date) ?? 0;
    // Written as (value - flow - prev) / prev rather than the algebraically
    // equivalent (value - flow) / prev - 1: the latter's extra floating-point
    // subtraction introduces IEEE-754 rounding noise (e.g. 1100/1000 - 1 ===
    // 0.10000000000000009, not 0.1) that this form avoids.
    out.push({ date: series[i].date, r: (series[i].value - flow - prev) / prev });
  }
  return out;
}

// Geometric link of a sub-period returns array. Telescopes to the naive
// (last/first - 1) ratio when every r_i is itself the naive per-period return.
export function computeTWR(returns: number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

export function annualise(cumulativeReturn: number, years: number): number {
  if (years <= 0) return 0;
  return ((1 + cumulativeReturn) ** (1 / years) - 1) * 100;
}

const XIRR_TOLERANCE = 1e-7;
const XIRR_MAX_ITER = 100;

function xirrNpv(rate: number, flows: { date: string; amountSgd: number }[], t0: number): number {
  return flows.reduce((sum, f) => {
    const years = (new Date(f.date).getTime() - t0) / MS_PER_YEAR;
    return sum + f.amountSgd / (1 + rate) ** years;
  }, 0);
}

function xirrDerivative(rate: number, flows: { date: string; amountSgd: number }[], t0: number): number {
  return flows.reduce((sum, f) => {
    const years = (new Date(f.date).getTime() - t0) / MS_PER_YEAR;
    if (years === 0) return sum;
    return sum - (years * f.amountSgd) / (1 + rate) ** (years + 1);
  }, 0);
}

function xirrBisection(flows: { date: string; amountSgd: number }[], t0: number): number {
  let lo = -0.9999;
  let hi = 10;
  let npvLo = xirrNpv(lo, flows, t0);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = xirrNpv(mid, flows, t0);
    if (Math.abs(npvMid) < XIRR_TOLERANCE) return mid;
    if ((npvMid > 0) === (npvLo > 0)) {
      lo = mid;
      npvLo = npvMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// Newton-Raphson with a bisection fallback over dated cash flows (must already
// be in the caller's XIRR sign convention: outflows negative, inflows
// positive — see buildXirrFlows). Returns 0 for fewer than 2 flows.
export function computeXIRR(flows: { date: string; amountSgd: number }[]): number {
  if (flows.length < 2) return 0;
  const t0 = new Date(flows[0].date).getTime();

  let rate = 0.1;
  for (let i = 0; i < XIRR_MAX_ITER; i++) {
    const npv = xirrNpv(rate, flows, t0);
    if (Math.abs(npv) < XIRR_TOLERANCE) return rate;
    const deriv = xirrDerivative(rate, flows, t0);
    if (Math.abs(deriv) < 1e-12) break;
    const next = rate - npv / deriv;
    if (!Number.isFinite(next) || next <= -1) break;
    rate = next;
  }
  return xirrBisection(flows, t0);
}

// Converts T7's cash_transactions (stored "positive = cash into the account")
// into standard XIRR sign convention (deposit = negative outflow from the
// investor, withdrawal/transfer-in = positive inflow), scoped by broker or
// fund source, and appends the final ending-value flow.
export function buildXirrFlows(
  cashTransactions: CashTransaction[],
  endingValueSgd: number,
  endingDate: string,
  scope?: { broker?: string; source?: string },
): { date: string; amountSgd: number }[] {
  let relevant: CashTransaction[];
  if (scope?.broker !== undefined) {
    relevant = cashTransactions.filter(
      (t) => t.broker === scope.broker && (t.type === "deposit" || t.type === "withdrawal" || t.type === "transfer"),
    );
  } else if (scope?.source !== undefined) {
    relevant = cashTransactions.filter(
      (t) => t.source === scope.source && (t.type === "deposit" || t.type === "withdrawal"),
    );
  } else {
    relevant = cashTransactions.filter((t) => t.type === "deposit" || t.type === "withdrawal");
  }

  const flows = relevant
    .map((t) => ({ date: t.date, amountSgd: -(t.amount * t.fxRate) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  flows.push({ date: endingDate, amountSgd: endingValueSgd });
  return flows;
}
