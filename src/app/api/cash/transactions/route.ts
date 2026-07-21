import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchCashTransactions } from "@/lib/supabase/data";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const transactions = await fetchCashTransactions(user.id);
  return NextResponse.json(transactions);
}
