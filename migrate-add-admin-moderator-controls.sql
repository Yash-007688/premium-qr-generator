-- Execute this script in your Supabase SQL Editor:
-- 1. Add tracking columns to public.profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ban_type TEXT CHECK (ban_type IN ('permanent', 'temporary'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS banned_until TIMESTAMP WITH TIME ZONE;

-- 2. Create helper security definer function to avoid infinite RLS recursion on the profiles table
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
DECLARE
  user_role TEXT;
BEGIN
  -- We query profiles directly. Since this is SECURITY DEFINER, it runs with high privileges, bypassing RLS.
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  RETURN (user_role = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Configure/Add RLS policies for public.profiles, public.wifi_qrs, and public.link_qrs
DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
CREATE POLICY "Admins can manage all profiles" ON public.profiles
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage all wifi_qrs" ON public.wifi_qrs;
CREATE POLICY "Admins can manage all wifi_qrs" ON public.wifi_qrs
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage all link_qrs" ON public.link_qrs;
CREATE POLICY "Admins can manage all link_qrs" ON public.link_qrs
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
