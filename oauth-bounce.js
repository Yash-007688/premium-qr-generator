// If Supabase Site URL is localhost, user lands here with #access_token — send to Vercel
(function oauthBounceFromLocalhost() {
    const hash = window.location.hash || '';
    if (!hash.includes('access_token')) return;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const production = 'https://premium-qr-generator.vercel.app';

    let target = (sessionStorage.getItem('qrweb_oauth_return_base') || '').replace(/\/$/, '');
    if (!target || target.includes('localhost') || target.includes('127.0.0.1')) {
        target = production;
    }

    const callback = target + '/auth-callback.html' + window.location.search + hash;

    if (isLocal) {
        window.location.replace(callback);
        return;
    }

    if (!window.location.pathname.includes('auth-callback')) {
        window.location.replace(window.location.origin.replace(/\/$/, '') + '/auth-callback.html' + window.location.search + hash);
    }
})();
