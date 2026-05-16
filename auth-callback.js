// Finishes Google OAuth — run on auth-callback.html (and legacy root hash URLs)
(async function finishOAuthSignIn() {
    if (typeof supabaseClient === 'undefined' || typeof redirectByRole !== 'function') return;

    const statusEl = document.getElementById('status');
    const params = new URLSearchParams(window.location.search);

    if (params.get('error')) {
        const desc = params.get('error_description') || params.get('error');
        alert('Sign-in failed: ' + decodeURIComponent(String(desc).replace(/\+/g, ' ')));
        window.location.replace('login.html');
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
        setTimeout(() => window.location.replace('login.html'), 800);
        return;
    }

    if (statusEl) statusEl.textContent = 'Success! Opening your dashboard...';
    await redirectByRole(session.user.id);
})();
