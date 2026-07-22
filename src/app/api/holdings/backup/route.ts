import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchHoldings, fetchRealizedLots } from "@/lib/supabase/data";
import { buildBackupEnvelope } from "@/lib/portfolio-io";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const [holdings, realized] = await Promise.all([
    fetchHoldings(user.id),
    fetchRealizedLots(user.id),
  ]);

  const envelope = buildBackupEnvelope(holdings, realized, new Date().toISOString());
  return NextResponse.json(envelope, {
    headers: {
      "Content-Disposition": 'attachment; filename="portfolio-backup.json"',
    },
  });
}
