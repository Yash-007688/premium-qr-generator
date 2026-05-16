// Finishes Google OAuth on auth-callback.html
(async function finishOAuthSignIn() {
    if (typeof supabaseClient === 'undefined' || typeof redirectByRole !== 'function') return;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const savedBase = sessionStorage.getItem('qrweb_oauth_return_base');
    const intendedBase = savedBase ? savedBase.replace(/\/$/, '') : '';

    // Supabase Site URL = localhost → user lands here with token; send them to Vercel
    if (isLocal && intendedBase && !intendedBase.includes('localhost') && !intendedBase.includes('127.0.0.1')) {
        const target = intendedBase + '/auth-callback.html' + window.location.search + window.location.hash;
        window.location.replace(target);
        return;
    }

    const statusEl = document.getElementById('status');
    const params = new URLSearchParams(window.location.search);

    if (params.get('error')) {
        const desc = params.get('error_description') || params.get('error');
        alert('Sign-in failed: ' + decodeURIComponent(String(desc).replace(/\+/g, ' ')));
        window.location.replace(getOAuthReturnBase() + '/login.html');
        return;
    }

    const hasToken = window.location.hash && window.location.hash.includes('access_token');

    if (hasToken) {
        await supabaseClient.auth.getSession();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session) {
        if (statusEl) statusEl.textContent = 'Sign-in failed. Redirecting to login...';
        setTimeout(() => window.location.replace(getOAuthReturnBase() + '/login.html'), 800);
        return;
    }

    sessionStorage.removeItem('qrweb_oauth_return_base');

    if (statusEl) statusEl.textContent = 'Success! Opening your dashboard...';
    await redirectByRole(session.user.id);
})();
