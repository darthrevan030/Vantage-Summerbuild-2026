import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/guards";
import { fetchUserSettings, deleteAllLotsForUser } from "@/lib/supabase/data";
import { commitLot, validateLotInput } from "@/lib/holdings/commit-lot";
import {
  parseBackup,
  orderLotsForRestore,
  backupLotToCommitInput,
  remapAllocations,
} from "@/lib/portfolio-io";

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body || (body.mode !== "append" && body.mode !== "replace"))
    return NextResponse.json({ error: "mode must be 'append' or 'replace'" }, { status: 400 });

  let envelope;
  try {
    const text =
      typeof body.envelope === "string" ? body.envelope : JSON.stringify(body.envelope);
    envelope = parseBackup(text);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid backup" },
      { status: 400 },
    );
  }

  const { buys, sells } = orderLotsForRestore(envelope.lots);

  // Validate the whole envelope before touching the DB (never wipe on bad data).
  for (const lot of [...buys, ...sells]) {
    const msg = validateLotInput(backupLotToCommitInput(lot));
    if (msg)
      return NextResponse.json(
        { error: `Invalid lot (${lot.ticker || "?"}): ${msg}` },
        { status: 400 },
      );
  }

  const userSettings = await fetchUserSettings(user.id);

  if (body.mode === "replace") await deleteAllLotsForUser(user.id);

  const idMap: Record<string, string> = {};
  let restored = 0;
  let failed = 0;
  const errors: string[] = [];
  const note = (t: string, e: unknown) => {
    failed++;
    if (errors.length < 5) errors.push(`${t}: ${e instanceof Error ? e.message : "failed"}`);
  };

  for (const lot of buys) {
    try {
      const row = await commitLot(user.id, backupLotToCommitInput(lot), userSettings);
      idMap[lot.id] = row.id;
      restored++;
    } catch (e) {
      note(lot.ticker, e);
    }
  }

  for (const lot of sells) {
    const input = backupLotToCommitInput(lot);
    input.transaction_type = "sell";
    const meta = envelope.sells[lot.id];
    if (meta) {
      input.cost_basis_method = meta.method;
      if (meta.method === "specific") {
        try {
          input.lot_allocations = remapAllocations(meta.allocations, idMap);
        } catch (e) {
          note(lot.ticker, e);
          continue;
        }
      }
    }
    try {
      await commitLot(user.id, input, userSettings);
      restored++;
    } catch (e) {
      note(lot.ticker, e);
    }
  }

  return NextResponse.json({ restored, failed, errors });
}
