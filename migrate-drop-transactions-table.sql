-- Remove duplicate transactions table — app uses public.payments only
-- Run in Supabase SQL Editor
--
-- Tip: If transactions has old rows you need, export CSV from Table Editor before running.

-- 1. Ensure payments table + policies exist
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    plan_name TEXT,
    tokens_purchased INTEGER NOT NULL DEFAULT 0,
    amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_gateway TEXT NOT NULL DEFAULT 'razorpay',
    razorpay_payment_id TEXT,
    razorpay_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS plan_name TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS tokens_purchased INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_gateway TEXT NOT NULL DEFAULT 'razorpay';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "Users can insert their own payments" ON public.payments;
CREATE POLICY "Users can insert their own payments" ON public.payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;
CREATE POLICY "Authenticated users can read payments" ON public.payments
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins can manage all payments" ON public.payments;
CREATE POLICY "Admins can manage all payments" ON public.payments
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2. Best-effort copy from transactions → payments (only if table exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'transactions'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'user_id'
        ) THEN
            EXECUTE $sql$
                INSERT INTO public.payments (
                    user_id, plan_name, tokens_purchased, amount,
                    payment_gateway, razorpay_payment_id, razorpay_order_id,
                    status, created_at, updated_at
                )
                SELECT
                    t.user_id,
                    COALESCE(
                        to_jsonb(t)->>'plan_name',
                        to_jsonb(t)->>'description',
                        'Migrated from transactions'
                    ),
                    COALESCE(
                        NULLIF(to_jsonb(t)->>'tokens_purchased', '')::integer,
                        NULLIF(to_jsonb(t)->>'tokens', '')::integer,
                        0
                    ),
                    COALESCE(NULLIF(to_jsonb(t)->>'amount', '')::numeric, 0),
                    COALESCE(
                        to_jsonb(t)->>'payment_gateway',
                        to_jsonb(t)->>'gateway',
                        'legacy'
                    ),
                    to_jsonb(t)->>'razorpay_payment_id',
                    to_jsonb(t)->>'razorpay_order_id',
                    COALESCE(to_jsonb(t)->>'status', 'success'),
                    COALESCE(
                        NULLIF(to_jsonb(t)->>'created_at', '')::timestamptz,
                        timezone('utc', now())
                    ),
                    COALESCE(
                        NULLIF(to_jsonb(t)->>'updated_at', '')::timestamptz,
                        timezone('utc', now())
                    )
                FROM public.transactions t
                WHERE t.user_id IS NOT NULL
            $sql$;
        END IF;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Skipping transactions → payments copy: %', SQLERRM;
END;
$$;

-- 3. Drop duplicate table(s)
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.transaction CASCADE;

NOTIFY pgrst, 'reload schema';
