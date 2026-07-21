import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchSnapshots, fetchCashTransactions, fetchHoldings } from "@/lib/supabase/data";
import { computePortfolioAnalytics } from "@/lib/portfolio";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const [snapshots, cashTransactions, holdings] = await Promise.all([
    fetchSnapshots(user.id),
    fetchCashTransactions(user.id),
    fetchHoldings(user.id),
  ]);
  const analytics = computePortfolioAnalytics(snapshots, cashTransactions, holdings);
  return NextResponse.json(analytics);
}
