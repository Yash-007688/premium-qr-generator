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
