-- supabase/migrations/20260614140000_app_config_frankfurter.sql
INSERT INTO app_config (key, value)
VALUES ('frankfurter', 'true'::jsonb) ON CONFLICT DO NOTHING;