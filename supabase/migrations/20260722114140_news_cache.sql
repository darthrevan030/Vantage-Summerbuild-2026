-- Shared, admin-written cache of merged+ranked news per symbol.
-- Freshness (4h TTL) is enforced in app code (src/app/api/news/route.ts), not here.
-- Mirrors fx_history: readable by any authenticated user; writes only via the
-- service-role client (no INSERT/UPDATE policy is granted to authenticated).
CREATE TABLE IF NOT EXISTS news_cache (
  symbol       text PRIMARY KEY,
  items        jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz DEFAULT now()
);
ALTER TABLE news_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "news_cache_read" ON news_cache
  FOR SELECT TO authenticated USING (true);
