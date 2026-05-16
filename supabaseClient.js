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
const OAUTH_RETURN_KEY = 'qrweb_oauth_return_base';

function isLocalHost(host) {
    return host === 'localhost' || host === '127.0.0.1';
}

function getAppBaseUrl() {
    const host = window.location.hostname;
    const fromEnv = (cfg.APP_URL || '').replace(/\/$/, '');

    if (host.includes('vercel.app')) {
        return fromEnv && fromEnv.includes('vercel.app') ? fromEnv : PRODUCTION_APP_URL;
    }

    if (!isLocalHost(host)) {
        return window.location.origin.replace(/\/$/, '');
    }

    return window.location.origin.replace(/\/$/, '');
}

/** Call right before Google OAuth — remembers Vercel (or current site) for return trip */
function saveOAuthReturnBase() {
    const base = getAppBaseUrl();
    sessionStorage.setItem(OAUTH_RETURN_KEY, base);
    return base;
}

/** Where user should land after login (not Supabase localhost Site URL) */
function getOAuthReturnBase() {
    const saved = sessionStorage.getItem(OAUTH_RETURN_KEY);
    if (saved) return saved.replace(/\/$/, '');

    const host = window.location.hostname;
    if (isLocalHost(host)) return getAppBaseUrl();

    return getAppBaseUrl();
}

function getOAuthRedirectUrl() {
    return saveOAuthReturnBase() + '/auth-callback.html';
}

/** Used when signing in from Vercel — forces Supabase redirect target */
function getProductionOAuthRedirectUrl() {
    sessionStorage.setItem(OAUTH_RETURN_KEY, PRODUCTION_APP_URL);
    return PRODUCTION_APP_URL + '/auth-callback.html';
}
