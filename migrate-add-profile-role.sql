-- Run in Supabase SQL Editor if profiles already exists without role

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('user', 'admin'));

UPDATE public.profiles SET role = 'user' WHERE role IS NULL;

-- Promote your admin account (replace with your email):
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
