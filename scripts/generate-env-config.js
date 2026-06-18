const fs = require('fs');
const path = require('path');

function loadDotEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
    }
}

loadDotEnv();

// Never expose GOOGLE_CLIENT_SECRET in env.config.js — static sites are public.
const config = {
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
    APP_URL: (process.env.APP_URL || '').replace(/\/$/, ''),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || ''
};

if (process.env.GOOGLE_CLIENT_SECRET) {
    console.log('Note: GOOGLE_CLIENT_SECRET is in .env but must be pasted in Supabase Dashboard → Auth → Google.');
}

const outPath = path.join(__dirname, '..', 'env.config.js');
const content = `// Auto-generated — do not edit. Run: npm run build:config\nwindow.APP_CONFIG = ${JSON.stringify(config, null, 4)};\n`;

fs.writeFileSync(outPath, content, 'utf8');
console.log('Wrote env.config.js');
