-- ─────────────────────────────────────────────────────────────────────────────
-- SGX Feature Integration
-- Adds: fund source, dividend yield, previous-close price, fixed-income metadata,
--       buy/sell transaction type, brokerage fees; new tables for cash balances,
--       shared ticker price-history cache, and CPF account balances.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend holdings ───────────────────────────────────────────────────────

ALTER TABLE holdings
  ADD COLUMN IF NOT EXISTS source             text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dividend_yield     numeric,
  ADD COLUMN IF NOT EXISTS dividend_yield_auto numeric,
  ADD COLUMN IF NOT EXISTS prev_price         numeric,
  ADD COLUMN IF NOT EXISTS prev_price_source  text,
  ADD COLUMN IF NOT EXISTS maturity_date      date,
  ADD COLUMN IF NOT EXISTS par_value          numeric,
  ADD COLUMN IF NOT EXISTS coupon_rate        numeric,
  ADD COLUMN IF NOT EXISTS transaction_type   text    NOT NULL DEFAULT 'buy',
  ADD COLUMN IF NOT EXISTS fees               numeric NOT NULL DEFAULT 0;

-- ── 2. Cash balances ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_balances (
  user_id  text    NOT NULL,
  currency text    NOT NULL,
  amount   numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, currency)
);

ALTER TABLE cash_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_balances_self"
  ON cash_balances FOR ALL
  USING  ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

-- ── 3. Ticker history cache (shared across all users, written by service role) ──

CREATE TABLE IF NOT EXISTS ticker_history (
  ticker          text PRIMARY KEY,
  daily_closes    jsonb NOT NULL DEFAULT '[]'::jsonb,
  monthly_closes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_date     date  NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE ticker_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticker_history_read"
  ON ticker_history FOR SELECT TO authenticated
  USING (true);

-- ── 4. CPF balances (single user, one row per user_id) ───────────────────────

CREATE TABLE IF NOT EXISTS cpf_balances (
  user_id    text    PRIMARY KEY,
  oa         numeric NOT NULL DEFAULT 0,
  sa         numeric NOT NULL DEFAULT 0,
  ma         numeric NOT NULL DEFAULT 0,
  ra         numeric NOT NULL DEFAULT 0,
  as_at_date date    NOT NULL DEFAULT CURRENT_DATE,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cpf_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cpf_balances_self"
  ON cpf_balances FOR ALL
  USING  ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

-- ── 5. App config: new provider flags + CPF LIFE rates ───────────────────────

INSERT INTO app_config (key, value) VALUES
  ('sgx',         'true'::jsonb),
  ('frankfurter', 'true'::jsonb),
  ('anthropic',   'true'::jsonb),
  ('cpf_life_rates', '{
    "basic": {
      "65": 7.58,
      "70": 9.21,
      "80": 14.47
    },
    "standard": {
      "65": 8.94,
      "70": 10.89,
      "80": 17.08
    }
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
