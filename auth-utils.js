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

async function checkAndEnforceBanExpiry(profile, session) {
    if (!profile) return { isBanned: false, profile: null };
    
    if (profile.is_banned) {
        // If it's a temporary ban and has expired, unban them automatically!
        if (profile.ban_type === 'temporary' && profile.banned_until) {
            const expiry = new Date(profile.banned_until);
            if (new Date() > expiry) {
                try {
                    await supabaseClient.from('profiles').update({
                        is_banned: false,
                        ban_reason: null,
                        ban_type: null,
                        banned_until: null
                    }).eq('id', profile.id);
                    
                    // Update local object states so validation succeeds
                    profile.is_banned = false;
                    profile.ban_reason = null;
                    profile.ban_type = null;
                    profile.banned_until = null;
                    return { isBanned: false, profile };
                } catch (e) {
                    console.error("Failed to automatically lift temporary ban:", e);
                }
            }
        }
        
        // Ban is still active. Build dynamic parameters and redirect!
        const reason = encodeURIComponent(profile.ban_reason || 'No reason specified');
        const type = encodeURIComponent(profile.ban_type || 'permanent');
        const until = profile.banned_until ? encodeURIComponent(profile.banned_until) : '';
        
        await supabaseClient.auth.signOut();
        window.location.replace(`${getPostLoginBase()}/banned.html?reason=${reason}&type=${type}&until=${until}`);
        return { isBanned: true, profile };
    }
    
    return { isBanned: false, profile };
}

async function redirectByRole(userId) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await ensureUserProfile(session);

    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, role, is_banned, ban_reason, ban_type, banned_until')
        .eq('id', userId)
        .maybeSingle();

    const check = await checkAndEnforceBanExpiry(data, session);
    if (check.isBanned) return;

    const role = check.profile?.role === 'admin' ? 'admin' : 'user';
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
    
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, role, is_banned, ban_reason, ban_type, banned_until')
        .eq('id', session.user.id)
        .maybeSingle();

    const check = await checkAndEnforceBanExpiry(data, session);
    if (check.isBanned) return false;

    const role = check.profile?.role === 'admin' ? 'admin' : 'user';
    if (role !== 'admin') {
        window.location.replace(getPostLoginBase() + '/dashboard.html');
        return false;
    }
    return true;
}

// === CENTRALIZED UNIFIED PROFILE DROPDOWN INJECTOR ===
async function injectUnifiedDropdown(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;

        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('id, full_name, role, is_banned, ban_reason, ban_type, banned_until')
            .eq('id', session.user.id)
            .maybeSingle();

        const check = await checkAndEnforceBanExpiry(profile, session);
        if (check.isBanned) return;

        const activeProfile = check.profile;
        const fullName = activeProfile?.full_name || session.user.email.split('@')[0];
        const isAdmin = activeProfile?.role === 'admin';

        // Create unified glassmorphic dropdown container
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'profile-dropdown-container';

        const adminItem = isAdmin ? `<a class="dropdown-item" href="admin.html">✨ Admin Panel</a>` : '';

        dropdownContainer.innerHTML = `
            <div class="profile-trigger" id="profile-trigger-btn">
                <span>👤 ${fullName}</span>
                <span class="arrow">▼</span>
            </div>
            <div class="dropdown-menu" id="profile-dropdown-menu">
                <a class="dropdown-item" href="profile.html">👤 My Profile</a>
                <a class="dropdown-item" href="dashboard.html?studio=1">📶 Creator Studio</a>
                ${adminItem}
                <div class="dropdown-divider"></div>
                <div class="dropdown-item logout" id="dropdown-logout-btn">🚪 Log Out</div>
            </div>
        `;

        // Adapt navigation injection depending on the target navbar selector
        if (containerSelector === '.nav-links') {
            // Landing page navbar
            container.innerHTML = '';
            container.appendChild(dropdownContainer);
        } else if (containerSelector === '.dashboard-nav') {
            // Studio/Admin/Profile navbars - keep logo, replace others
            const logo = container.querySelector('.logo');
            container.innerHTML = '';
            if (logo) container.appendChild(logo);
            container.appendChild(dropdownContainer);
        } else {
            container.appendChild(dropdownContainer);
        }

        // Bind dropdown toggles
        const trigger = dropdownContainer.querySelector('#profile-trigger-btn');
        const menu = dropdownContainer.querySelector('#profile-dropdown-menu');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            trigger.classList.toggle('active');
            menu.classList.toggle('show');
        });

        // Click outside to close
        document.addEventListener('click', () => {
            trigger.classList.remove('active');
            menu.classList.remove('show');
        });

        // Handle Logout inside dropdown
        dropdownContainer.querySelector('#dropdown-logout-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                // Clear all session storage and auth storage keys to wipe local credentials instantly
                sessionStorage.clear();
                localStorage.clear();
                await supabaseClient.auth.signOut();
            } catch (err) {
                console.error("SignOut exception handled:", err);
            }
            window.location.href = "index.html";
        });

    } catch (err) {
        console.error("Unified dropdown injection failed:", err);
    }
}

// === SILENT GITHUB TIMESTAMP SYNC TO SUPABASE ===
// Fetches the latest GitHub commit timestamp for the current page and saves it
// to the `page_timestamps` Supabase table. No visible UI is rendered.
async function syncPageTimestampToSupabase() {
    // Determine the current filename
    let path = window.location.pathname;
    let filename = path.substring(path.lastIndexOf('/') + 1);
    if (!filename || filename === '/') {
        filename = 'index.html';
    }

    // Local cache to avoid hammering GitHub API on every page load
    const cacheKey = `github_commit_${filename}`;
    const cacheTimeKey = `github_commit_time_${filename}`;
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);

    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

    let lastUpdatedAt = null;
    let commitSha = null;
    let commitUrl = null;

    if (cachedData && cachedTime && (now - parseInt(cachedTime, 10) < CACHE_DURATION)) {
        try {
            const parsed = JSON.parse(cachedData);
            lastUpdatedAt = parsed.dateISO;
            commitUrl = parsed.url;
            commitSha = parsed.sha;
        } catch (e) {
            console.error("Failed to parse cached commit data", e);
        }
    } else {
        try {
            const repo = "Yash-007688/premium-qr-generator";
            const response = await fetch(`https://api.github.com/repos/${repo}/commits?path=${filename}&per_page=1`);
            if (response.ok) {
                const commits = await response.json();
                if (commits && commits.length > 0) {
                    const latestCommit = commits[0];
                    lastUpdatedAt = latestCommit.commit.committer.date;
                    commitUrl = latestCommit.html_url;
                    commitSha = latestCommit.sha;

                    // Cache it
                    const dataToCache = {
                        dateISO: lastUpdatedAt,
                        url: commitUrl,
                        sha: commitSha
                    };
                    localStorage.setItem(cacheKey, JSON.stringify(dataToCache));
                    localStorage.setItem(cacheTimeKey, now.toString());
                } else {
                    // Fallback to last repo commit if file-specific commit is empty
                    const repoResponse = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`);
                    if (repoResponse.ok) {
                        const repoCommits = await repoResponse.json();
                        if (repoCommits && repoCommits.length > 0) {
                            const latestCommit = repoCommits[0];
                            lastUpdatedAt = latestCommit.commit.committer.date;
                            commitUrl = latestCommit.html_url;
                            commitSha = latestCommit.sha;
                        }
                    }
                }
            }
        } catch (err) {
            console.error("GitHub API fetch failed:", err);
            if (cachedData) {
                try {
                    const parsed = JSON.parse(cachedData);
                    lastUpdatedAt = parsed.dateISO;
                    commitUrl = parsed.url;
                    commitSha = parsed.sha;
                } catch (e) {}
            }
        }
    }

    // Save to Supabase page_timestamps table (upsert by page_name)
    if (lastUpdatedAt && typeof supabaseClient !== 'undefined') {
        try {
            await supabaseClient.from('page_timestamps').upsert(
                {
                    page_name: filename,
                    last_updated_at: lastUpdatedAt,
                    commit_sha: commitSha,
                    commit_url: commitUrl,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'page_name' }
            );
        } catch (e) {
            console.error("Failed to sync page timestamp to Supabase:", e);
        }
    }
}

// Automatically sync timestamp on DOM load (silently, no UI)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncPageTimestampToSupabase);
} else {
    syncPageTimestampToSupabase();
}

