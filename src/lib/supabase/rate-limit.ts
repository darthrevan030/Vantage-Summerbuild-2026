import { createClient } from "@/lib/supabase/server";

/**
 * Returns a 429 Response if the caller has exhausted `bucket`, else null.
 * Uses the request-scoped (cookie-authed) client so the RPC's auth.uid() resolves.
 *
 * Default is FAIL-OPEN (return null on RPC error): a transient DB blip won't block
 * a paying user. Pass { failClosed: true } on routes where cost-per-call matters more
 * than UX availability (e.g. the analyst LLM route).
 */
export async function enforceRateLimit(
  bucket: string,
  max: number,
  windowSecs: number,
  opts: { failClosed?: boolean } = {}
): Promise<Response | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket: bucket,
    p_max: max,
    p_window_secs: windowSecs,
  });

  if (error) {
    console.error("[rate-limit] rpc error:", error.message);
    if (!opts.failClosed) return null;
  }

  const allowed = error ? false : data === true;
  if (allowed) return null;

  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(windowSecs),
    },
  });
}
