-- ============================================================
-- Migration: Add Token System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Add token columns to profiles table
--    tokens: current available balance (default 100 for new users)
--    total_tokens_used: lifetime tokens spent (for analytics)
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS tokens INTEGER NOT NULL DEFAULT 20;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS total_tokens_used INTEGER NOT NULL DEFAULT 0;

-- 2. Add tokens_spent column to wifi_qrs table
--    Tracks how many tokens were spent for each QR generation
ALTER TABLE public.wifi_qrs
    ADD COLUMN IF NOT EXISTS tokens_spent INTEGER NOT NULL DEFAULT 0;

-- 3. Add tokens_spent column to link_qrs table
ALTER TABLE public.link_qrs
    ADD COLUMN IF NOT EXISTS tokens_spent INTEGER NOT NULL DEFAULT 0;

-- 4. Allow users to update their own token balance (needed for deduction)
--    The existing "Users can update their own profile" policy already covers this
--    since tokens is a column on profiles. No new policy needed.

-- 5. (Optional) If you want admins to be able to update ANY user's tokens,
--    you may need an admin update policy. This is already handled if you have
--    an admin policy from previous migrations. Otherwise, add:
-- CREATE POLICY "Admins can update all profiles" ON public.profiles
--     FOR UPDATE USING (
--         EXISTS (
--             SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
--         )
--     );
