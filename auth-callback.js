// Only runs on auth-callback.html (or legacy URLs with OAuth hash)
(async function finishOAuthSignIn() {
    if (typeof supabaseClient === 'undefined' || typeof redirectByRole !== 'function') return;

    const path = window.location.pathname || '';
    const onCallbackPage = path.includes('auth-callback');
    const hasToken = window.location.hash && window.location.hash.includes('access_token');
    const hasOAuthError = new URLSearchParams(window.location.search).get('error');

    if (!onCallbackPage && !hasToken && !hasOAuthError) return;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const savedBase = sessionStorage.getItem('qrweb_oauth_return_base');
    const intendedBase = savedBase ? savedBase.replace(/\/$/, '') : '';

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

    if (hasToken) {
        await supabaseClient.auth.getSession();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session) {
        if (statusEl) statusEl.textContent = 'Sign-in failed. Redirecting to login...';
        if (onCallbackPage) {
            setTimeout(() => window.location.replace(getOAuthReturnBase() + '/login.html'), 800);
        }
        return;
    }

    sessionStorage.removeItem('qrweb_oauth_return_base');

    await ensureUserProfile(session);

    if (statusEl) statusEl.textContent = 'Success! Opening your dashboard...';
    await redirectByRole(session.user.id);
})();
