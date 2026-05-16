const fs = require('fs');
const path = require('path');

function loadDotEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        console.error('Missing .env — copy .env.example to .env first.');
        process.exit(1);
    }
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
        process.env[key] = value;
    }
}

loadDotEnv();

const id = process.env.GOOGLE_CLIENT_ID || '';
const secret = process.env.GOOGLE_CLIENT_SECRET || '';

console.log('\n--- Google OAuth (.env) ---\n');
console.log('Client ID:     ', id ? `${id.slice(0, 20)}...` : '(empty)');
console.log('Client Secret: ', secret ? `${secret.slice(0, 8)}... (set)` : '(empty)');

if (!id || !secret) {
    console.log('\nFill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env\n');
    process.exit(1);
}

console.log('\nNext step (required for login to work):');
console.log('1. Open Supabase → Authentication → Providers → Google');
console.log('2. Paste the SAME Client ID and Client Secret from .env');
console.log('3. Save\n');
console.log('The secret is NOT sent to the browser — only Supabase uses it.\n');
