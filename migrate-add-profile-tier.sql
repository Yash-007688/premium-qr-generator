-- Migration: Add tier column to profiles
-- Run this in your Supabase SQL Editor if profiles already exists without tier

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free';

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_tier_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_tier_check
CHECK (tier IN ('free', 'pro', 'enterprise'));

UPDATE public.profiles SET tier = 'free' WHERE tier IS NULL;
