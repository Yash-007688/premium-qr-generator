-- Sync user_tokens <-> profiles.tokens (run in Supabase SQL Editor)

-- 1. Ensure token columns exist on profiles
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS tokens INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS total_tokens_used INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill user_tokens from profiles (if row missing)
INSERT INTO public.user_tokens (user_id, balance, total_spent)
SELECT p.id, COALESCE(p.tokens, 20), COALESCE(p.total_tokens_used, 0)
FROM public.profiles p
LEFT JOIN public.user_tokens ut ON ut.user_id = p.id
WHERE ut.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- 3. Backfill profiles from user_tokens (source of truth)
UPDATE public.profiles p
SET
    tokens = ut.balance,
    total_tokens_used = ut.total_spent
FROM public.user_tokens ut
WHERE p.id = ut.user_id;

-- 4. Auto-sync profiles whenever user_tokens changes
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
        total_tokens_used = NEW.total_spent
    WHERE id = NEW.user_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_tokens ON public.user_tokens;
CREATE TRIGGER trg_sync_profile_tokens
    AFTER INSERT OR UPDATE OF balance, total_spent ON public.user_tokens
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_tokens_from_user_tokens();

-- 5. New users: profiles + user_tokens both get 20 tokens
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, role, tokens, total_tokens_used)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.email,
        'user',
        20,
        0
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_tokens (user_id, balance, total_spent)
    VALUES (NEW.id, 20, 0)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 6. RLS policies for user_tokens (users + admins)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    RETURN user_role = 'admin';
END;
$$;

DROP POLICY IF EXISTS "Users can insert their own tokens row" ON public.user_tokens;
CREATE POLICY "Users can insert their own tokens row" ON public.user_tokens
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all user tokens" ON public.user_tokens;
CREATE POLICY "Admins can read all user tokens" ON public.user_tokens
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert user tokens" ON public.user_tokens;
CREATE POLICY "Admins can insert user tokens" ON public.user_tokens
    FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update all user tokens" ON public.user_tokens;
CREATE POLICY "Admins can update all user tokens" ON public.user_tokens
    FOR UPDATE USING (public.is_admin());

NOTIFY pgrst, 'reload schema';
