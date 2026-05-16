-- Run this in Supabase SQL Editor if wifi_qrs already exists without connection_type

ALTER TABLE public.wifi_qrs
ADD COLUMN IF NOT EXISTS connection_type TEXT NOT NULL DEFAULT 'wifi';

ALTER TABLE public.wifi_qrs
DROP CONSTRAINT IF EXISTS wifi_qrs_connection_type_check;

ALTER TABLE public.wifi_qrs
ADD CONSTRAINT wifi_qrs_connection_type_check
CHECK (connection_type IN ('wifi', 'hotspot'));

UPDATE public.wifi_qrs SET connection_type = 'wifi' WHERE connection_type IS NULL;
