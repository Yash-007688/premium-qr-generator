-- Run this if admin panel cannot read/update other users' tokens
-- (Requires migrate-add-admin-moderator-controls.sql for is_admin())

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
