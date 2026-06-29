-- Plan daily drip: free=100, pro=300, enterprise=500 (run if migrate-add-daily-token-columns.sql not run yet)

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

NOTIFY pgrst, 'reload schema';
