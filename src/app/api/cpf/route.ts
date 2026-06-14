import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchCpfBalances, upsertCpfBalances } from "@/lib/supabase/data";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUM_MAX = 1e12;
const finiteNonNeg = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= NUM_MAX;
};

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const balances = await fetchCpfBalances(user.id);
  return NextResponse.json(balances);
}

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();
  const patch: Partial<{ oa: number; sa: number; ma: number; ra: number; asAtDate: string }> = {};
  for (const k of ["oa", "sa", "ma", "ra"] as const) {
    if (body[k] !== undefined) {
      if (!finiteNonNeg(body[k]))
        return NextResponse.json({ error: `invalid ${k}` }, { status: 400 });
      patch[k] = Number(body[k]);
    }
  }
  if (body.asAtDate !== undefined) {
    if (!DATE_RE.test(String(body.asAtDate)))
      return NextResponse.json({ error: "invalid asAtDate" }, { status: 400 });
    patch.asAtDate = String(body.asAtDate);
  }
  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });

  await upsertCpfBalances(user.id, patch);
  return NextResponse.json({ ok: true });
}
