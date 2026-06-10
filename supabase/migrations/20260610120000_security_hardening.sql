-- Security hardening:
-- 1. Column-level privileges: stop authenticated users from writing user_settings.role
-- 2. SECURITY DEFINER is_admin() to break RLS policy self-reference (42P17)
-- 3. Recreate admin policies using is_admin()
-- 4. DB-level guard against demoting the last admin (closes app-layer TOCTOU race)

-- ── 1. Column-level write privileges on user_settings ────────────────────────
-- Supabase's default privileges grant table-level ALL to anon/authenticated.
-- A column-level REVOKE is a no-op while the table-level grant exists, so the
-- table-level INSERT/UPDATE must be revoked and only safe columns re-granted.
-- service_role keeps its own full grant and is unaffected.
REVOKE INSERT, UPDATE ON public.user_settings FROM anon, authenticated;

-- user_id must stay in the UPDATE grant: PostgREST upserts
-- (INSERT ... ON CONFLICT DO UPDATE SET <posted cols>) update every posted
-- column including the PK. RLS WITH CHECK still pins it to auth.uid().
GRANT INSERT (user_id, display_name, base_currency, created_at, updated_at)
  ON public.user_settings TO authenticated;
GRANT UPDATE (user_id, display_name, base_currency, updated_at)
  ON public.user_settings TO authenticated;

-- ── 2. is_admin(): SECURITY DEFINER breaks policy self-reference ─────────────
-- Owned by the migration role (postgres), which owns user_settings, so the
-- lookup bypasses RLS on user_settings — no recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = (SELECT auth.uid())::text
      AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ── 3. Recreate admin policies without self-referencing subqueries ───────────
DROP POLICY IF EXISTS "Admins can read all user settings" ON public.user_settings;
CREATE POLICY "Admins can read all user settings"
  ON public.user_settings
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can read all holdings" ON public.holdings;
CREATE POLICY "Admins can read all holdings"
  ON public.holdings
  FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_write" ON public.exchanges;
CREATE POLICY "admin_write"
  ON public.exchanges
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- currencies intentionally keeps no write policy: writes go through the
-- service role only (see /api/admin/currencies).

-- ── 4. Last-admin demotion guard (race-proof backstop for the app check) ─────
-- SECURITY DEFINER so the admin count sees all rows regardless of caller RLS.
-- The advisory xact lock serialises concurrent demotions.
CREATE OR REPLACE FUNCTION public.prevent_last_admin_demotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
    PERFORM pg_advisory_xact_lock(hashtext('user_settings_last_admin'));
    IF (SELECT count(*) FROM public.user_settings WHERE role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last admin'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_demotion ON public.user_settings;
CREATE TRIGGER trg_prevent_last_admin_demotion
  BEFORE UPDATE OF role ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_admin_demotion();
