-- Plan ↔ tokens ↔ payments auto-sync (run in Supabase SQL Editor)
-- free = 20 tokens | pro = 50 tokens | enterprise = 500 tokens
-- Requires: profiles.tier, user_tokens, payments, migrate-sync-tokens-profile.sql

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role text;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    RETURN user_role = 'admin';
END;
$$;

-- 1. Plan helpers
CREATE OR REPLACE FUNCTION public.get_tier_token_grant(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_tier
        WHEN 'pro' THEN 50
        WHEN 'enterprise' THEN 500
        ELSE 20
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_plan_amount(p_tier text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_tier
        WHEN 'pro' THEN 799
        WHEN 'enterprise' THEN 3999
        ELSE 0
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_plan_name(p_tier text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_tier
        WHEN 'pro' THEN 'Pro Subscription'
        WHEN 'enterprise' THEN 'Enterprise Subscription'
        ELSE 'Free Plan'
    END;
$$;

-- 2. Set user_tokens balance to plan allowance (keeps total_spent)
CREATE OR REPLACE FUNCTION public.grant_tokens_for_tier(p_user_id uuid, p_tier text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_grant integer;
BEGIN
    v_grant := public.get_tier_token_grant(p_tier);

    INSERT INTO public.user_tokens (user_id, balance, total_spent)
    VALUES (p_user_id, v_grant, 0)
    ON CONFLICT (user_id) DO UPDATE SET
        balance = v_grant,
        updated_at = timezone('utc', now());

    RETURN v_grant;
END;
$$;

-- 3. Main RPC: tier change + tokens + payment (app / admin panel)
CREATE OR REPLACE FUNCTION public.apply_user_tier_plan(
    p_user_id uuid,
    p_tier text,
    p_source text DEFAULT 'system',
    p_amount numeric DEFAULT NULL,
    p_razorpay_payment_id text DEFAULT NULL,
    p_razorpay_order_id text DEFAULT NULL,
    p_plan_suffix text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_tier text;
    v_tokens integer;
    v_amount numeric;
    v_plan_name text;
BEGIN
    IF p_tier NOT IN ('free', 'pro', 'enterprise') THEN
        RAISE EXCEPTION 'Invalid tier: %', p_tier;
    END IF;

    IF auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorized to change this user plan';
    END IF;

    SELECT tier INTO v_old_tier FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found';
    END IF;

    IF v_old_tier IS NOT DISTINCT FROM p_tier THEN
        RETURN jsonb_build_object(
            'success', true,
            'unchanged', true,
            'tier', p_tier,
            'tokens', public.get_tier_token_grant(p_tier)
        );
    END IF;

    PERFORM set_config('app.skip_tier_sync', 'true', true);

    UPDATE public.profiles SET tier = p_tier WHERE id = p_user_id;

    v_tokens := public.grant_tokens_for_tier(p_user_id, p_tier);
    v_amount := COALESCE(p_amount, public.get_tier_plan_amount(p_tier));
    v_plan_name := public.get_tier_plan_name(p_tier);
    IF p_plan_suffix IS NOT NULL AND length(trim(p_plan_suffix)) > 0 THEN
        v_plan_name := v_plan_name || ' (' || trim(p_plan_suffix) || ')';
    END IF;

    INSERT INTO public.payments (
        user_id,
        plan_name,
        tokens_purchased,
        amount,
        payment_gateway,
        razorpay_payment_id,
        razorpay_order_id,
        status,
        updated_at
    ) VALUES (
        p_user_id,
        v_plan_name,
        v_tokens,
        v_amount,
        COALESCE(NULLIF(trim(p_source), ''), 'system'),
        p_razorpay_payment_id,
        p_razorpay_order_id,
        'success',
        timezone('utc', now())
    );

    PERFORM set_config('app.skip_tier_sync', 'false', true);

    RETURN jsonb_build_object(
        'success', true,
        'tier', p_tier,
        'old_tier', v_old_tier,
        'tokens', v_tokens,
        'amount', v_amount,
        'plan_name', v_plan_name
    );
EXCEPTION
    WHEN OTHERS THEN
        PERFORM set_config('app.skip_tier_sync', 'false', true);
        RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_user_tier_plan TO authenticated;

-- 4. Auto-sync when tier edited directly in Supabase Table Editor
CREATE OR REPLACE FUNCTION public.sync_tier_plan_on_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tokens integer;
BEGIN
    IF current_setting('app.skip_tier_sync', true) = 'true' THEN
        RETURN NEW;
    END IF;

    IF OLD.tier IS NOT DISTINCT FROM NEW.tier THEN
        RETURN NEW;
    END IF;

    v_tokens := public.grant_tokens_for_tier(NEW.id, NEW.tier);

    INSERT INTO public.payments (
        user_id,
        plan_name,
        tokens_purchased,
        amount,
        payment_gateway,
        status,
        updated_at
    ) VALUES (
        NEW.id,
        public.get_tier_plan_name(NEW.tier) || ' (DB Auto Sync)',
        v_tokens,
        public.get_tier_plan_amount(NEW.tier),
        'admin_manual',
        'success',
        timezone('utc', now())
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_tier_plan ON public.profiles;
CREATE TRIGGER trg_sync_tier_plan
    AFTER UPDATE OF tier ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_tier_plan_on_profile_update();

-- 5. Backfill: align tokens with current tier for all users
UPDATE public.user_tokens ut
SET balance = public.get_tier_token_grant(p.tier),
    updated_at = timezone('utc', now())
FROM public.profiles p
WHERE ut.user_id = p.id;

UPDATE public.profiles p
SET tokens = ut.balance,
    total_tokens_used = ut.total_spent
FROM public.user_tokens ut
WHERE p.id = ut.user_id;

NOTIFY pgrst, 'reload schema';
