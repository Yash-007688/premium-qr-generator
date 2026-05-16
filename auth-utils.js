async function ensureUserProfile(session) {
    if (!session?.user) return { error: 'No session' };

    const meta = session.user.user_metadata || {};
    const fullName = meta.full_name || meta.name || meta.fullName || '';

    const { error } = await supabaseClient.from('profiles').upsert(
        {
            id: session.user.id,
            email: session.user.email,
            full_name: fullName
        },
        { onConflict: 'id' }
    );

    if (error) console.error('Profile save failed:', error.message);
    return { error: error?.message || null };
}

async function fetchUserRole(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

    if (error || !data) return 'user';
    return data.role === 'admin' ? 'admin' : 'user';
}

function getPostLoginBase() {
    if (typeof getOAuthReturnBase === 'function') {
        const base = getOAuthReturnBase().replace(/\/$/, '');
        if (base && !base.includes('localhost') && !base.includes('127.0.0.1')) return base;
    }
    if (typeof getAppBaseUrl === 'function') {
        const base = getAppBaseUrl().replace(/\/$/, '');
        if (base.includes('vercel.app')) return base;
    }
    return window.location.origin.replace(/\/$/, '');
}

async function redirectByRole(userId) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await ensureUserProfile(session);

    const role = await fetchUserRole(userId);
    const base = getPostLoginBase();
    const page = role === 'admin' ? 'admin.html' : 'dashboard.html';
    window.location.replace(base + '/' + page);
}

async function requireAdmin() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return false;
    }
    const role = await fetchUserRole(session.user.id);
    if (role !== 'admin') {
        window.location.replace(getPostLoginBase() + '/dashboard.html');
        return false;
    }
    return true;
}
