ALTER TABLE public.user_tokens ADD COLUMN IF NOT EXISTS last_drip_date DATE;
ALTER TABLE public.user_tokens ADD COLUMN IF NOT EXISTS monthly_drip_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.user_tokens ADD COLUMN IF NOT EXISTS monthly_drip_month TEXT;

CREATE OR REPLACE FUNCTION public.get_tier_monthly_cap(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS '
    SELECT CASE p_tier
        WHEN ''pro''        THEN 5000
        WHEN ''enterprise'' THEN 8000
        ELSE 3000
    END;
';

CREATE OR REPLACE FUNCTION public.get_tier_daily_drip(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS '
    SELECT (public.get_tier_monthly_cap(p_tier) + 29) / 30;
';

CREATE OR REPLACE FUNCTION public.get_tier_token_grant(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS '
    SELECT public.get_tier_daily_drip(p_tier);
';

CREATE OR REPLACE FUNCTION public.apply_daily_token_drip(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
    v_tier          text;
    v_daily_drip    integer;
    v_monthly_cap   integer;
    v_today         date;
    v_today_month   text;
    v_monthly_used  integer;
    v_monthly_month text;
    v_last_drip     date;
    v_current_bal   integer;
    v_headroom      integer;
    v_grant         integer;
    v_new_balance   integer;
BEGIN
    v_today       := (NOW() AT TIME ZONE ''Asia/Kolkata'')::date;
    v_today_month := to_char(v_today, ''YYYY-MM'');

    SELECT tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(''success'', false, ''reason'', ''user_not_found'');
    END IF;

    v_daily_drip  := public.get_tier_daily_drip(v_tier);
    v_monthly_cap := public.get_tier_monthly_cap(v_tier);

    SELECT balance, last_drip_date, monthly_drip_used, monthly_drip_month
    INTO v_current_bal, v_last_drip, v_monthly_used, v_monthly_month
    FROM public.user_tokens
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(''success'', false, ''reason'', ''token_row_not_found'');
    END IF;

    IF v_last_drip = v_today THEN
        RETURN jsonb_build_object(
            ''success'', true,
            ''granted'', 0,
            ''reason'', ''already_dripped_today'',
            ''balance'', v_current_bal
        );
    END IF;

    IF v_monthly_month IS DISTINCT FROM v_today_month THEN
        v_monthly_used  := 0;
        v_monthly_month := v_today_month;
    END IF;

    v_headroom := v_monthly_cap - v_monthly_used;
    IF v_headroom <= 0 THEN
        UPDATE public.user_tokens
        SET last_drip_date = v_today
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            ''success'', true,
            ''granted'', 0,
            ''reason'', ''monthly_cap_reached'',
            ''balance'', v_current_bal,
            ''monthly_cap'', v_monthly_cap
        );
    END IF;

    v_grant       := LEAST(v_daily_drip, v_headroom);
    v_new_balance := v_current_bal + v_grant;

    UPDATE public.user_tokens
    SET
        balance            = v_new_balance,
        last_drip_date     = v_today,
        monthly_drip_used  = v_monthly_used + v_grant,
        monthly_drip_month = v_today_month,
        updated_at         = timezone(''utc'', now())
    WHERE user_id = p_user_id;

    UPDATE public.profiles
    SET tokens = v_new_balance
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
        ''success'',       true,
        ''granted'',       v_grant,
        ''reason'',        ''drip_applied'',
        ''balance'',       v_new_balance,
        ''monthly_used'',  v_monthly_used + v_grant,
        ''monthly_cap'',   v_monthly_cap,
        ''tier'',          v_tier
    );
END;
';

GRANT EXECUTE ON FUNCTION public.apply_daily_token_drip TO authenticated;

CREATE OR REPLACE FUNCTION public.run_daily_drip_for_all_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
    v_user_id   uuid;
    v_processed integer := 0;
    v_skipped   integer := 0;
    v_today     date;
BEGIN
    v_today := (NOW() AT TIME ZONE ''Asia/Kolkata'')::date;

    FOR v_user_id IN
        SELECT ut.user_id
        FROM public.user_tokens ut
        WHERE (ut.last_drip_date IS NULL OR ut.last_drip_date < v_today)
    LOOP
        PERFORM public.apply_daily_token_drip(v_user_id);
        v_processed := v_processed + 1;
    END LOOP;

    RETURN jsonb_build_object(
        ''processed'', v_processed,
        ''skipped'',   v_skipped,
        ''run_date'',  v_today
    );
END;
';

DO '
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = ''pg_cron'') THEN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = ''daily-token-drip'';
        PERFORM cron.schedule(
            ''daily-token-drip'',
            ''30 18 * * *'',
            ''SELECT public.run_daily_drip_for_all_users();''
        );
    END IF;
END;
';

CREATE OR REPLACE FUNCTION public.claim_daily_drip()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
BEGIN
    RETURN public.apply_daily_token_drip(auth.uid());
END;
';

GRANT EXECUTE ON FUNCTION public.claim_daily_drip TO authenticated;

SELECT public.run_daily_drip_for_all_users();

UPDATE public.user_tokens
SET
    monthly_drip_month = to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM'),
    monthly_drip_used  = 0
WHERE monthly_drip_month IS NULL;

NOTIFY pgrst, 'reload schema';
