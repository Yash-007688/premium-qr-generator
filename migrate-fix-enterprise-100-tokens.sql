-- Plan monthly caps: free=3000, pro=5000, enterprise=8000 (run in Supabase SQL Editor)

CREATE OR REPLACE FUNCTION public.get_tier_monthly_cap(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_tier
        WHEN 'pro'        THEN 5000
        WHEN 'enterprise' THEN 8000
        ELSE 3000
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_daily_drip(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (public.get_tier_monthly_cap(p_tier) + 29) / 30;
$$;

CREATE OR REPLACE FUNCTION public.get_tier_token_grant(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT public.get_tier_daily_drip(p_tier);
$$;

NOTIFY pgrst, 'reload schema';
