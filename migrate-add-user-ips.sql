-- Migration: add user_ips table to track IP addresses per user
-- Run this in your Supabase SQL editor or via migration tooling

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_ips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    ip text NOT NULL,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    seen_count integer NOT NULL DEFAULT 1
);

-- Prevent duplicate rows for the same user/ip pair so we can upsert
CREATE UNIQUE INDEX IF NOT EXISTS user_ips_user_id_ip_idx ON user_ips (user_id, ip);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_ips ENABLE ROW LEVEL SECURITY;

-- Security Policies for user_ips
CREATE POLICY "Users can insert their own user_ips" ON public.user_ips
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own user_ips" ON public.user_ips
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own user_ips" ON public.user_ips
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all user_ips" ON public.user_ips
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
