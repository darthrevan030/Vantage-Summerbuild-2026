-- Introduces a 'superadmin' tier above 'admin'. Superadmins are the only tier
-- that may promote, demote, or delete admins (and other superadmins); plain
-- admins keep their data access and may delete ordinary users only.
--
-- Invariant: the system must always retain at least one superadmin. The DB
-- trigger below is the race-proof backstop for both demotion and deletion.

-- ── 1. is_admin() now spans both admin tiers ─────────────────────────────────
-- Every existing RLS policy keys off is_admin(); widening it here means
-- superadmins inherit all admin data access without touching any policy.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = (SELECT auth.uid())::text
      AND role IN ('admin', 'superadmin')
  );
$$;

-- ── 2. is_superadmin(): top-tier-only checks ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_settings
    WHERE user_id = (SELECT auth.uid())::text
      AND role = 'superadmin'
  );
$$;

-- ── 3. Drop the old last-admin guard FIRST ──────────────────────────────────
-- It fires on UPDATE OF role and treats admin→superadmin as "leaving admin",
-- so it would block the bootstrap below on the last admin row. The superadmin
-- replacement is installed in step 6.
DROP TRIGGER IF EXISTS trg_prevent_last_admin_demotion ON public.user_settings;
DROP FUNCTION IF EXISTS public.prevent_last_admin_demotion();

-- ── 4. Bootstrap: every current admin becomes a superadmin ───────────────────
-- Non-destructive and guarantees the >=1 superadmin invariant immediately (no
-- lockout, no hardcoded identity). Demote peers back to plain 'admin' afterward
-- from the admin dashboard as desired.
UPDATE public.user_settings SET role = 'superadmin' WHERE role = 'admin';

-- ── 5. Constrain role to the known set ───────────────────────────────────────
ALTER TABLE public.user_settings
  DROP CONSTRAINT IF EXISTS user_settings_role_check;
ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_role_check
  CHECK (role IN ('user', 'admin', 'superadmin'));

-- ── 6. Last-superadmin lockout backstop (demotion AND deletion) ──────────────
-- Replaces the old prevent_last_admin_demotion guard; the protected tier is now
-- superadmin. Covers UPDATE OF role (demotion) and DELETE (account removal).
CREATE OR REPLACE FUNCTION public.prevent_last_superadmin_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  losing_superadmin boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    losing_superadmin := (OLD.role = 'superadmin');
  ELSE  -- UPDATE
    losing_superadmin := (OLD.role = 'superadmin'
                          AND NEW.role IS DISTINCT FROM 'superadmin');
  END IF;

  IF losing_superadmin THEN
    PERFORM pg_advisory_xact_lock(hashtext('user_settings_last_superadmin'));
    IF (SELECT count(*) FROM public.user_settings WHERE role = 'superadmin') <= 1 THEN
      RAISE EXCEPTION 'cannot remove the last superadmin'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_superadmin_demote ON public.user_settings;
CREATE TRIGGER trg_prevent_last_superadmin_demote
  BEFORE UPDATE OF role ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_superadmin_loss();

DROP TRIGGER IF EXISTS trg_prevent_last_superadmin_delete ON public.user_settings;
CREATE TRIGGER trg_prevent_last_superadmin_delete
  BEFORE DELETE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_superadmin_loss();
