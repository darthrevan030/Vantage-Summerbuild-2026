import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchSnapshots } from "@/lib/supabase/data";
import { computePortfolioAnalytics } from "@/lib/portfolio";

// Risk/return analytics (CAGR, Sharpe, vol, drawdown, best/worst day) derived
// from the user's portfolio_snapshots history.
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const snapshots = await fetchSnapshots(user.id);
  const analytics = computePortfolioAnalytics(snapshots);
  return NextResponse.json(analytics);
}
