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

function getAppBaseUrl() {
    // Always use the site the user is on (Vercel, localhost, etc.)
    return window.location.origin.replace(/\/$/, '');
}

function getOAuthRedirectUrl() {
    return getAppBaseUrl() + '/dashboard.html';
}
