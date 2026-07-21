-- T7: cash & contributions ledger.
-- Adds cash_transactions (the new source of truth for cash movement) and
-- user_settings.track_cash. Migrates existing cash_balances rows into
-- cash_transactions as deposits (preserving real user data), then drops
-- cash_balances.

-- ── 1. cash_transactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cash_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  lot_id            uuid REFERENCES lots(id) ON DELETE CASCADE,
  transfer_group_id uuid,
  date              date NOT NULL,
  type              text NOT NULL CHECK (type IN ('deposit','withdrawal','transfer','fee','dividend_cash','buy','sell')),
  currency          text NOT NULL,
  amount            numeric NOT NULL,
  fx_rate           numeric NOT NULL DEFAULT 1,
  broker            text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT '',
  note              text,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own cash transactions" ON cash_transactions;
CREATE POLICY "Users can manage own cash transactions" ON cash_transactions
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

DROP POLICY IF EXISTS "Admins can read all cash transactions" ON cash_transactions;
CREATE POLICY "Admins can read all cash transactions" ON cash_transactions
  FOR SELECT
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS cash_transactions_user_id_idx  ON cash_transactions(user_id);
CREATE INDEX IF NOT EXISTS cash_transactions_lot_id_idx   ON cash_transactions(lot_id);
CREATE INDEX IF NOT EXISTS cash_transactions_transfer_idx ON cash_transactions(transfer_group_id);

-- ── 2. user_settings.track_cash ───────────────────────────────────────────────
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS track_cash boolean NOT NULL DEFAULT true;

GRANT INSERT (user_id, display_name, base_currency, cost_basis_method, track_cash, created_at, updated_at)
  ON public.user_settings TO authenticated;
GRANT UPDATE (user_id, display_name, base_currency, cost_basis_method, track_cash, updated_at)
  ON public.user_settings TO authenticated;

-- ── 3. Data migration: preserve existing cash_balances as deposit rows ────────
INSERT INTO cash_transactions (user_id, date, type, currency, amount, fx_rate, note)
SELECT
  cb.user_id,
  CURRENT_DATE,
  'deposit',
  cb.currency,
  cb.amount,
  COALESCE(c.rate_sgd, 1),
  'migrated from cash_balances'
FROM cash_balances cb
LEFT JOIN currencies c ON c.code = cb.currency
WHERE cb.amount > 0;

-- ── 4. Drop the superseded table ──────────────────────────────────────────────
DROP TABLE IF EXISTS cash_balances;
