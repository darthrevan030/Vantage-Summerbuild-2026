-- T6: realized P&L + cost-basis engine.
-- Adds realized_lots (one row per matched buy<->sell pair, frozen at
-- sell-commit time — never a live join against the current lot values) and a
-- per-user cost-basis method default.

-- ── 1. realized_lots ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS realized_lots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  instrument_id     uuid NOT NULL REFERENCES instruments(id),
  sell_lot_id       uuid NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  buy_lot_id        uuid NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  method            text NOT NULL CHECK (method IN ('fifo','average','specific')),
  matched_quantity  numeric NOT NULL CHECK (matched_quantity > 0),
  matched_buy_price numeric NOT NULL,
  matched_buy_fx    numeric NOT NULL,
  sell_price        numeric NOT NULL,
  sell_fx           numeric NOT NULL,
  asset_gain_sgd    numeric NOT NULL,
  fx_gain_sgd       numeric NOT NULL,
  realized_date     date NOT NULL,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE realized_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own realized lots" ON realized_lots;
CREATE POLICY "Users can manage own realized lots" ON realized_lots
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Admins can read all realized lots" ON realized_lots;
CREATE POLICY "Admins can read all realized lots" ON realized_lots
  FOR SELECT
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS realized_lots_user_id_idx       ON realized_lots(user_id);
CREATE INDEX IF NOT EXISTS realized_lots_instrument_id_idx ON realized_lots(instrument_id);
CREATE INDEX IF NOT EXISTS realized_lots_sell_lot_id_idx   ON realized_lots(sell_lot_id);
CREATE INDEX IF NOT EXISTS realized_lots_buy_lot_id_idx    ON realized_lots(buy_lot_id);

-- ── 2. user_settings.cost_basis_method ────────────────────────────────────────
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS cost_basis_method text NOT NULL DEFAULT 'fifo';

ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_cost_basis_method_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_cost_basis_method_check
  CHECK (cost_basis_method IN ('fifo', 'average', 'specific'));

-- Re-issue the column-privilege grants from 20260610025339_security_hardening.sql
-- with cost_basis_method appended — GRANT on a column list replaces the set,
-- it doesn't incrementally add, so the full list must be restated.
GRANT INSERT (user_id, display_name, base_currency, cost_basis_method, created_at, updated_at)
  ON public.user_settings TO authenticated;
GRANT UPDATE (user_id, display_name, base_currency, cost_basis_method, updated_at)
  ON public.user_settings TO authenticated;
