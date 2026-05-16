// Handles Google OAuth return when Supabase redirects to Site URL root with #access_token
(async function handleOAuthHashReturn() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return;
    if (typeof supabaseClient === 'undefined' || typeof redirectByRole !== 'function') return;

    const path = window.location.pathname || '/';
    const onAuthPage = /dashboard\.html|admin\.html|login\.html|signup\.html/i.test(path);
    if (onAuthPage) return;

    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) return;

    window.history.replaceState({}, document.title, path);
    await redirectByRole(session.user.id);
})();
