-- Fixed-window rate-limit counters. Only the SECURITY DEFINER function writes here;
-- authenticated/anon get no direct grant (the table owner bypasses RLS).
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      text        NOT NULL,
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Atomically increments the caller's counter for the current window and reports
-- whether they are still under the cap. Returns false for unauthenticated callers.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket      text,
  p_max         integer,
  p_window_secs integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user   text := (SELECT auth.uid())::text;
  v_window timestamptz := date_bin(
    make_interval(secs => p_window_secs), now(), TIMESTAMPTZ 'epoch'
  );
  v_count  integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limits (user_id, bucket, window_start, count)
  VALUES (v_user, p_bucket, v_window, 1)
  ON CONFLICT (user_id, bucket, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO authenticated;

-- Optional housekeeping: prune windows older than a day. Schedule with pg_cron if enabled,
-- or run manually — stale rows are harmless, just dead weight.
-- SELECT cron.schedule('rl-prune','*/30 * * * *',
--   $$DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day'$$);

-- Append-only audit log for privilege-sensitive admin actions.
-- Writes go through the service-role client (bypasses RLS); no INSERT policy needed.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   text        NOT NULL,
  action     text        NOT NULL,
  target_id  text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
CREATE POLICY "admins read audit log" ON public.audit_log
  FOR SELECT USING (public.is_admin());
