-- Run in Supabase SQL Editor

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

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own payments" ON public.payments;
CREATE POLICY "Users can insert their own payments" ON public.payments
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can read payments" ON public.payments;
CREATE POLICY "Authenticated users can read payments" ON public.payments
    FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can insert their own tokens row" ON public.user_tokens;
CREATE POLICY "Users can insert their own tokens row" ON public.user_tokens
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Backfill user_tokens for existing profiles missing a row
INSERT INTO public.user_tokens (user_id, balance, total_spent)
SELECT p.id, 20, 0
FROM public.profiles p
LEFT JOIN public.user_tokens ut ON ut.user_id = p.id
WHERE ut.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
