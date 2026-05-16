// Load from env.config.js (generated from .env) or env.config.example.js
const cfg = window.APP_CONFIG || {};

const supabaseUrl = cfg.SUPABASE_URL || 'https://viqqmphewqrwmvyosfep.supabase.co';
const supabaseAnonKey = cfg.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpcXFtcGhld3Fyd212eW9zZmVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDk0MTIsImV4cCI6MjA5NDQ4NTQxMn0.F6mPKM88MRBsze8NRkPz2Xi4neB-OlSMOkEhHEqj6dc';

const { createClient } = supabase;
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

function getAppBaseUrl() {
    const fromEnv = (cfg.APP_URL || '').replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return window.location.origin;
}

function getOAuthRedirectUrl() {
    return getAppBaseUrl() + '/dashboard.html';
}
