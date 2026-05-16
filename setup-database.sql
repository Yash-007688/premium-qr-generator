-- Execute this script in your Supabase SQL Editor

-- 1. Create Profiles Table (Public Auth Table)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create the Wi-Fi QRs table (Interconnected with profiles)
CREATE TABLE public.wifi_qrs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ssid TEXT NOT NULL,
    connection_type TEXT NOT NULL DEFAULT 'wifi' CHECK (connection_type IN ('wifi', 'hotspot')),
    template_name TEXT,
    qr_image_data TEXT, -- Base64 encoded image string
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create the Link QRs table (Interconnected with profiles)
CREATE TABLE public.link_qrs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    url TEXT NOT NULL,
    template_name TEXT,
    qr_image_data TEXT, -- Base64 encoded image string
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wifi_qrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_qrs ENABLE ROW LEVEL SECURITY;

-- 5. Create Security Policies
-- Profiles
CREATE POLICY "Authenticated users can read all profiles" ON public.profiles
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Wi-Fi QRs
CREATE POLICY "Users can insert their own wifi qrs" ON public.wifi_qrs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read all wifi qrs" ON public.wifi_qrs
    FOR SELECT USING (auth.role() = 'authenticated');

-- Link QRs
CREATE POLICY "Users can insert their own link qrs" ON public.link_qrs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read all link qrs" ON public.link_qrs
    FOR SELECT USING (auth.role() = 'authenticated');

-- 4b. Create the Hotspot QRs table (Mobile Hotspot)
CREATE TABLE public.hotspot_qrs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ssid TEXT NOT NULL,
    template_name TEXT,
    qr_image_data TEXT, -- Base64 encoded image string
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.hotspot_qrs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own hotspot qrs" ON public.hotspot_qrs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can read all hotspot qrs" ON public.hotspot_qrs
    FOR SELECT USING (auth.role() = 'authenticated');

-- 6. Trigger to automatically sync auth.users to public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS '
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>''full_name'', 
    new.email,
    ''user''
  );
  RETURN new;
END;
' LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
