-- Migration: Add page_timestamps table to track last updated timestamps per page
-- Run this in your Supabase SQL Editor

-- 1. Create the page_timestamps table
CREATE TABLE public.page_timestamps (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    page_name TEXT NOT NULL UNIQUE,
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    commit_sha TEXT,
    commit_url TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Enable Row Level Security
ALTER TABLE public.page_timestamps ENABLE ROW LEVEL SECURITY;

-- 3. Anyone authenticated can read page timestamps
CREATE POLICY "Authenticated users can read page timestamps" ON public.page_timestamps
    FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Anyone authenticated can insert page timestamps
CREATE POLICY "Authenticated users can insert page timestamps" ON public.page_timestamps
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 5. Anyone authenticated can update page timestamps
CREATE POLICY "Authenticated users can update page timestamps" ON public.page_timestamps
    FOR UPDATE USING (auth.role() = 'authenticated');
