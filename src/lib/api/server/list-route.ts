import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Builds a GET handler that lists a reference table ordered by display_order,
 * returning `fallback` whenever the table is unreachable (pre-setup DBs).
 */
export function createTableListGET<Row>(table: string, columns: string, fallback: Row[]) {
  return async function GET() {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .order("display_order");

      if (error || !data) return NextResponse.json(fallback);
      return NextResponse.json(data);
    } catch (e) {
      console.error("[list-route] %s unreachable:", table, e);
      return NextResponse.json(fallback);
    }
  };
}
