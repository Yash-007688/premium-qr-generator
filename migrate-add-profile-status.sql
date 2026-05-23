-- Migration: add status and last_seen columns to profiles
-- Run this in your Supabase SQL editor or via migration tooling

ALTER TABLE IF EXISTS profiles
    ADD COLUMN IF NOT EXISTS status text DEFAULT 'offline',
    ADD COLUMN IF NOT EXISTS last_seen timestamptz;

-- Optional: Index to quickly query online users
CREATE INDEX IF NOT EXISTS profiles_status_idx ON profiles (status);
