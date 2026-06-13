-- ============================================================
-- Migration: Create Decoupled User Tokens Table
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Create user_tokens table
CREATE TABLE IF NOT EXISTS public.user_tokens (
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 20,
    total_spent INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Migrate existing token data from profiles to user_tokens (if columns exist)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema='public' AND table_name='profiles' AND column_name='tokens'
    ) THEN
        INSERT INTO public.user_tokens (user_id, balance, total_spent)
        SELECT id, tokens, total_tokens_used FROM public.profiles
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
END $$;

-- 3. Enable RLS
ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies
DROP POLICY IF EXISTS "Users can view their own tokens" ON public.user_tokens;
CREATE POLICY "Users can view their own tokens" ON public.user_tokens
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tokens" ON public.user_tokens;
CREATE POLICY "Users can update their own tokens" ON public.user_tokens
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can update all user tokens" ON public.user_tokens;
CREATE POLICY "Admins can update all user tokens" ON public.user_tokens
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 5. Update Auth Signup Trigger Function to auto-insert into user_tokens
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>''full_name'', 
    new.email,
    ''user''
  );
  
  INSERT INTO public.user_tokens (user_id, balance, total_spent)
  VALUES (new.id, 20, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Reload schema cache
NOTIFY pgrst, 'reload schema';
