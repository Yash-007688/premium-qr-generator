async function fetchUserRole(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

    if (error || !data) return 'user';
    return data.role === 'admin' ? 'admin' : 'user';
}

async function redirectByRole(userId) {
    const role = await fetchUserRole(userId);
    window.location.replace(role === 'admin' ? 'admin.html' : 'dashboard.html');
}

async function requireAdmin() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
        return false;
    }
    const role = await fetchUserRole(session.user.id);
    if (role !== 'admin') {
        window.location.replace('dashboard.html');
        return false;
    }
    return true;
}
