-- ============================================================================
-- Schema Normalisation
-- Splits the monolithic `holdings` table into:
--   user data    → instruments + lots + holding_overrides
--   market cache → ticker_quotes + ticker_dividends (+ existing ticker_history)
-- Migrates all existing holdings rows, then drops `holdings`.
-- A full copy is retained out-of-band in holdings_backup_20260615.
-- ============================================================================

-- ── 1. instruments — one row per listed security (global, shared, no user_id) ─
CREATE TABLE IF NOT EXISTS instruments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol        text NOT NULL,
  exchange_code text REFERENCES exchanges(code),   -- NULL for physical (Gold/RE)
  asset_type    text NOT NULL,
  currency      text NOT NULL,
  name          text NOT NULL DEFAULT '',
  flag          text NOT NULL DEFAULT '🌐',
  icon          text NOT NULL DEFAULT 'briefcase',
  par_value     numeric,                            -- Bond/T-Bill face value per unit
  coupon_rate   numeric,                            -- Bond annual coupon %
  maturity_date date,                               -- Bond/T-Bill maturity
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT instruments_symbol_exchange_uniq UNIQUE NULLS NOT DISTINCT (symbol, exchange_code)
);

ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
-- Authenticated users may read instruments (needed for the lots → instruments embed).
-- INSERT/UPDATE happen only via the service-role admin client (prevents name injection).
CREATE POLICY "instruments_read" ON instruments
  FOR SELECT TO authenticated USING (true);

-- ── 2. lots — one row per transaction leg (replaces holdings) ─────────────────
CREATE TABLE IF NOT EXISTS lots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  instrument_id    uuid NOT NULL REFERENCES instruments(id),
  transaction_type text NOT NULL DEFAULT 'buy',     -- buy | sell
  quantity         numeric NOT NULL,
  price            numeric NOT NULL,                 -- per-unit, in instrument currency
  trade_date       date NOT NULL,
  fx_rate          numeric NOT NULL DEFAULT 1,       -- instrument ccy → SGD at trade date
  fees             numeric NOT NULL DEFAULT 0,
  source           text NOT NULL DEFAULT '',         -- CPF | SRS | Cash | ''
  broker           text NOT NULL DEFAULT '',
  strategy         text NOT NULL DEFAULT '',
  notes            text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own lots" ON lots
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);
CREATE POLICY "Admins can read all lots" ON lots
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_settings
    WHERE user_id = (auth.uid())::text AND role = 'admin'
  ));

CREATE INDEX IF NOT EXISTS lots_user_id_idx       ON lots(user_id);
CREATE INDEX IF NOT EXISTS lots_instrument_id_idx ON lots(instrument_id);

-- ── 3. holding_overrides — per-user, per-instrument manual settings ───────────
CREATE TABLE IF NOT EXISTS holding_overrides (
  user_id        text NOT NULL,
  instrument_id  uuid NOT NULL REFERENCES instruments(id),
  dividend_yield numeric,                            -- manual % override; NULL = use auto
  PRIMARY KEY (user_id, instrument_id)
);

ALTER TABLE holding_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own overrides" ON holding_overrides
  FOR ALL
  USING ((auth.uid())::text = user_id)
  WITH CHECK ((auth.uid())::text = user_id);

-- ── 4. ticker_quotes — current price + spark (shared cache, admin-client write) ─
CREATE TABLE IF NOT EXISTS ticker_quotes (
  symbol            text PRIMARY KEY,
  current_price     numeric,
  prev_price        numeric,
  prev_price_source text,
  spark_data        jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_source      text,
  refreshed_at      timestamptz DEFAULT now()
);

ALTER TABLE ticker_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticker_quotes_read" ON ticker_quotes
  FOR SELECT TO authenticated USING (true);

-- ── 5. ticker_dividends — TTM dividend yield (shared cache) ───────────────────
CREATE TABLE IF NOT EXISTS ticker_dividends (
  symbol       text PRIMARY KEY,
  yield_ttm    numeric,
  source       text,
  refreshed_at timestamptz DEFAULT now()
);

ALTER TABLE ticker_dividends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticker_dividends_read" ON ticker_dividends
  FOR SELECT TO authenticated USING (true);

-- ── 6. ticker_history: rename ticker → symbol (idempotent) ────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ticker_history' AND column_name = 'ticker'
  ) THEN
    ALTER TABLE ticker_history RENAME COLUMN ticker TO symbol;
  END IF;
END $$;

-- ── 7. currencies.rate_sgd — single source of FX truth ────────────────────────
ALTER TABLE currencies ADD COLUMN IF NOT EXISTS rate_sgd numeric;
UPDATE currencies SET rate_sgd = CASE code
  WHEN 'SGD' THEN 1.0
  WHEN 'USD' THEN 1.36
  WHEN 'EUR' THEN 1.51
  WHEN 'GBP' THEN 1.72
  WHEN 'AUD' THEN 0.88
  WHEN 'JPY' THEN 0.0091
  WHEN 'INR' THEN 0.016
  WHEN 'HKD' THEN 0.174
  ELSE rate_sgd
END;

-- ── 8. Data migration: holdings → new tables ──────────────────────────────────

-- 8a. instruments: distinct securities (exchange unknown for legacy rows → NULL)
INSERT INTO instruments (symbol, exchange_code, asset_type, currency, name, flag, icon, par_value, coupon_rate, maturity_date)
SELECT DISTINCT ON (ticker, asset_type, currency)
  ticker, NULL, asset_type, currency, name, flag, icon, par_value, coupon_rate, maturity_date
FROM holdings
ORDER BY ticker, asset_type, currency, updated_at DESC
ON CONFLICT (symbol, exchange_code) DO NOTHING;

-- 8b. lots: one per holdings row (preserve original id, timestamps)
INSERT INTO lots (id, user_id, instrument_id, transaction_type, quantity, price, trade_date, fx_rate, fees, source, broker, strategy, notes, created_at, updated_at)
SELECT h.id, h.user_id, i.id, h.transaction_type, h.units, h.buy_price, h.buy_date,
       h.buy_fx_rate, h.fees, h.source, h.broker, h.strategy, h.notes, h.created_at, h.updated_at
FROM holdings h
JOIN instruments i
  ON  i.symbol = h.ticker
  AND i.asset_type = h.asset_type
  AND i.currency = h.currency
  AND i.exchange_code IS NULL;

-- 8c. ticker_quotes: latest priced row per symbol
INSERT INTO ticker_quotes (symbol, current_price, prev_price, prev_price_source, spark_data, refreshed_at)
SELECT DISTINCT ON (ticker)
  ticker, current_price, prev_price, prev_price_source, spark_data, COALESCE(price_refreshed_at, now())
FROM holdings
WHERE current_price > 0
ORDER BY ticker, price_refreshed_at DESC NULLS LAST
ON CONFLICT (symbol) DO NOTHING;

-- 8d. ticker_dividends: preserve any auto-derived TTM yields
INSERT INTO ticker_dividends (symbol, yield_ttm, source)
SELECT DISTINCT ON (ticker) ticker, dividend_yield_auto, 'migrated'
FROM holdings
WHERE dividend_yield_auto IS NOT NULL
ORDER BY ticker, updated_at DESC
ON CONFLICT (symbol) DO NOTHING;

-- 8e. holding_overrides: preserve any manual yield overrides
INSERT INTO holding_overrides (user_id, instrument_id, dividend_yield)
SELECT DISTINCT ON (h.user_id, i.id) h.user_id, i.id, h.dividend_yield
FROM holdings h
JOIN instruments i
  ON  i.symbol = h.ticker
  AND i.asset_type = h.asset_type
  AND i.currency = h.currency
  AND i.exchange_code IS NULL
WHERE h.dividend_yield IS NOT NULL
ORDER BY h.user_id, i.id, h.updated_at DESC
ON CONFLICT (user_id, instrument_id) DO NOTHING;

-- ── 9. Drop the legacy table (backup retained in holdings_backup_20260615) ─────
DROP TABLE holdings;
