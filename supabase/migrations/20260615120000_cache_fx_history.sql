-- Daily SGD-per-foreign FX rate history cache (shared, admin-written).
-- rates: { "YYYY-MM-DD": sgd_per_foreign }. Historical rates are immutable, so
-- the backfill only needs to fetch dates not already present here.
CREATE TABLE IF NOT EXISTS fx_history (
  currency     text PRIMARY KEY,
  rates        jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz DEFAULT now()
);
ALTER TABLE fx_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fx_history_read" ON fx_history
  FOR SELECT TO authenticated USING (true);
