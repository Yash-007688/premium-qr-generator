// Load from env.config.js (generated from .env) or env.config.example.js
const cfg = window.APP_CONFIG || {};

const supabaseUrl = cfg.SUPABASE_URL || 'https://viqqmphewqrwmvyosfep.supabase.co';
const supabaseAnonKey = cfg.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpcXFtcGhld3Fyd212eW9zZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDk0MTIsImV4cCI6MjA5NDQ4NTQxMn0.F6mPKM88MRBsze8NRkPz2Xi4neB-OlSMOkEhHEqj6dc';

const { createClient } = supabase;
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        detectSessionInUrl: true,
        persistSession: true
    }
});

const PRODUCTION_APP_URL = 'https://premium-qr-generator.vercel.app';

function getAppBaseUrl() {
    const host = window.location.hostname;
    const fromEnv = (cfg.APP_URL || '').replace(/\/$/, '');

    // On Vercel: force production URL so Supabase never falls back to localhost Site URL mismatch
    if (host.includes('vercel.app') || host === 'premium-qr-generator.vercel.app') {
        return fromEnv && fromEnv.includes('vercel.app') ? fromEnv : PRODUCTION_APP_URL;
    }

    return window.location.origin.replace(/\/$/, '');
}

function getOAuthRedirectUrl() {
    return getAppBaseUrl() + '/auth-callback.html';
}
