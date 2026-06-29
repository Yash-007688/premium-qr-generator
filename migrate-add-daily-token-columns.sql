-- Daily token columns + plan drip: free=100, pro=300, enterprise=500 per day
-- Run in Supabase SQL Editor

-- 1. Columns on profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS daily_tokens_left INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS daily_tokens_used INTEGER NOT NULL DEFAULT 0;

-- 2. Columns on user_tokens
ALTER TABLE public.user_tokens
    ADD COLUMN IF NOT EXISTS daily_tokens_left INTEGER NOT NULL DEFAULT 100;

ALTER TABLE public.user_tokens
    ADD COLUMN IF NOT EXISTS daily_tokens_used INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.user_tokens
    ADD COLUMN IF NOT EXISTS daily_token_date DATE;

-- 3. Plan helpers (fixed daily drip)
CREATE OR REPLACE FUNCTION public.get_tier_daily_drip(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_tier
        WHEN 'pro'        THEN 300
        WHEN 'enterprise' THEN 500
        ELSE 100
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_monthly_cap(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT public.get_tier_daily_drip(p_tier) * 30;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_token_grant(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT public.get_tier_daily_drip(p_tier);
$$;

-- 4. Sync profiles when user_tokens changes (balance + daily columns)
CREATE OR REPLACE FUNCTION public.sync_profile_tokens_from_user_tokens()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.profiles
    SET
        tokens = NEW.balance,
        total_tokens_used = NEW.total_spent,
        daily_tokens_left = NEW.daily_tokens_left,
        daily_tokens_used = NEW.daily_tokens_used
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_tokens ON public.user_tokens;
CREATE TRIGGER trg_sync_profile_tokens
    AFTER INSERT OR UPDATE OF balance, total_spent, daily_tokens_left, daily_tokens_used ON public.user_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_tokens_from_user_tokens();

-- 5. Reset daily counters for a user (new IST day)
CREATE OR REPLACE FUNCTION public.reset_daily_tokens_if_needed(p_user_id uuid, p_tier text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today date;
    v_drip  integer;
BEGIN
    v_today := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
    v_drip  := public.get_tier_daily_drip(p_tier);

    UPDATE public.user_tokens
    SET
        daily_tokens_used = 0,
        daily_tokens_left = v_drip,
        daily_token_date  = v_today,
        updated_at        = timezone('utc', now())
    WHERE user_id = p_user_id
      AND (daily_token_date IS NULL OR daily_token_date < v_today);
END;
$$;

-- 6. Daily drip (grants balance + resets daily left/used)
CREATE OR REPLACE FUNCTION public.apply_daily_token_drip(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tier              text;
    v_daily_drip        integer;
    v_monthly_cap       integer;
    v_today             date;
    v_today_month       text;
    v_monthly_used      integer;
    v_monthly_month     text;
    v_last_drip         date;
    v_daily_token_date  date;
    v_current_bal       integer;
    v_daily_used        integer;
    v_daily_left        integer;
    v_headroom          integer;
    v_grant             integer;
    v_new_balance       integer;
BEGIN
    v_today       := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
    v_today_month := to_char(v_today, 'YYYY-MM');

    SELECT tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
    END IF;

    v_daily_drip  := public.get_tier_daily_drip(v_tier);
    v_monthly_cap := public.get_tier_monthly_cap(v_tier);

    SELECT balance, last_drip_date, monthly_drip_used, monthly_drip_month,
           daily_tokens_used, daily_tokens_left, daily_token_date
    INTO v_current_bal, v_last_drip, v_monthly_used, v_monthly_month,
         v_daily_used, v_daily_left, v_daily_token_date
    FROM public.user_tokens
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'token_row_not_found');
    END IF;

    IF v_daily_token_date IS NULL OR v_daily_token_date < v_today THEN
        v_daily_used := 0;
        v_daily_left := v_daily_drip;
    END IF;

    IF v_last_drip = v_today THEN
        UPDATE public.user_tokens
        SET
            daily_tokens_used = v_daily_used,
            daily_tokens_left = v_daily_left,
            daily_token_date  = v_today
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'success', true,
            'granted', 0,
            'reason', 'already_dripped_today',
            'balance', v_current_bal,
            'daily_tokens_left', v_daily_left,
            'daily_tokens_used', v_daily_used,
            'daily_drip', v_daily_drip
        );
    END IF;

    IF v_monthly_month IS DISTINCT FROM v_today_month THEN
        v_monthly_used  := 0;
        v_monthly_month := v_today_month;
    END IF;

    v_headroom := v_monthly_cap - v_monthly_used;
    IF v_headroom <= 0 THEN
        UPDATE public.user_tokens
        SET
            last_drip_date     = v_today,
            daily_tokens_used  = 0,
            daily_tokens_left  = 0,
            daily_token_date   = v_today
        WHERE user_id = p_user_id;

        RETURN jsonb_build_object(
            'success', true,
            'granted', 0,
            'reason', 'monthly_cap_reached',
            'balance', v_current_bal,
            'daily_tokens_left', 0,
            'daily_tokens_used', v_daily_used,
            'monthly_cap', v_monthly_cap
        );
    END IF;

    v_grant       := LEAST(v_daily_drip, v_headroom);
    v_new_balance := v_current_bal + v_grant;
    v_daily_used  := 0;
    v_daily_left  := v_daily_drip;

    UPDATE public.user_tokens
    SET
        balance            = v_new_balance,
        last_drip_date     = v_today,
        monthly_drip_used  = v_monthly_used + v_grant,
        monthly_drip_month = v_today_month,
        daily_tokens_used  = v_daily_used,
        daily_tokens_left  = v_daily_left,
        daily_token_date   = v_today,
        updated_at         = timezone('utc', now())
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'granted', v_grant,
        'reason', 'drip_applied',
        'balance', v_new_balance,
        'daily_tokens_left', v_daily_left,
        'daily_tokens_used', v_daily_used,
        'daily_drip', v_daily_drip,
        'monthly_used', v_monthly_used + v_grant,
        'monthly_cap', v_monthly_cap,
        'tier', v_tier
    );
END;
$$;

-- 7. New signup: include daily columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, role, tokens, total_tokens_used, daily_tokens_left, daily_tokens_used)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.email,
        'user',
        100,
        0,
        100,
        0
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_tokens (user_id, balance, total_spent, daily_tokens_left, daily_tokens_used, daily_token_date)
    VALUES (NEW.id, 100, 0, 100, 0, (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- 8. Plan change: set daily left to tier drip
CREATE OR REPLACE FUNCTION public.grant_tokens_for_tier(p_user_id uuid, p_tier text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_grant integer;
BEGIN
    v_grant := public.get_tier_daily_drip(p_tier);

    INSERT INTO public.user_tokens (user_id, balance, total_spent, daily_tokens_left, daily_tokens_used, daily_token_date)
    VALUES (p_user_id, v_grant, 0, v_grant, 0, (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
    ON CONFLICT (user_id) DO UPDATE SET
        balance = v_grant,
        daily_tokens_left = v_grant,
        daily_tokens_used = 0,
        daily_token_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
        updated_at = timezone('utc', now());

    RETURN v_grant;
END;
$$;

-- 9. Backfill existing users
UPDATE public.user_tokens ut
SET
    daily_tokens_left = public.get_tier_daily_drip(p.tier),
    daily_tokens_used = 0,
    daily_token_date  = COALESCE(ut.daily_token_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
FROM public.profiles p
WHERE ut.user_id = p.id
  AND (ut.daily_token_date IS NULL OR ut.daily_tokens_left IS NULL);

UPDATE public.profiles p
SET
    daily_tokens_left = ut.daily_tokens_left,
    daily_tokens_used = ut.daily_tokens_used,
    tokens = ut.balance,
    total_tokens_used = ut.total_spent
FROM public.user_tokens ut
WHERE p.id = ut.user_id;

NOTIFY pgrst, 'reload schema';
