-- Migration: Add commit_name column to page_timestamps
-- Run this in your Supabase SQL Editor

ALTER TABLE public.page_timestamps
    ADD COLUMN IF NOT EXISTS commit_name TEXT;

-- No policy changes required for read/insert/update since column is nullable and covered by existing policies
