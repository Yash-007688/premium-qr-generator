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

// === DYNAMIC GITHUB-CONNECTED LAST UPDATED FOOTER INJECTOR ===
async function injectLastUpdatedFooter() {
    // Determine the current filename
    let path = window.location.pathname;
    let filename = path.substring(path.lastIndexOf('/') + 1);
    if (!filename || filename === '/') {
        filename = 'index.html';
    }

    // Create footer element if it doesn't exist
    let footer = document.querySelector('footer.page-footer');
    if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'page-footer';
        
        // Custom injection logic based on page type to maintain perfect layouts
        const authContainer = document.querySelector('.auth-container');
        const suspendedContainer = document.querySelector('.suspended-container');
        
        if (authContainer) {
            // For login/signup page - place inside the container below the card
            authContainer.appendChild(footer);
            footer.style.marginTop = '1.5rem';
        } else if (suspendedContainer) {
            // For banned page - place inside container below the content
            suspendedContainer.appendChild(footer);
            footer.style.marginTop = '1.5rem';
        } else {
            // For standard dashboard/admin/landing pages - append to body
            document.body.appendChild(footer);
            footer.style.marginTop = 'auto';
        }
    }

    // Apply beautiful, premium styles to the footer
    footer.style.textAlign = 'center';
    footer.style.padding = '2rem 1.5rem';
    footer.style.fontSize = '0.8rem';
    footer.style.color = 'var(--text-muted, #94a3b8)';
    footer.style.borderTop = '1px solid var(--border-color, rgba(255, 255, 255, 0.08))';
    footer.style.width = '100%';
    footer.style.display = 'flex';
    footer.style.flexDirection = 'column';
    footer.style.alignItems = 'center';
    footer.style.gap = '0.5rem';
    footer.style.zIndex = '10';
    footer.style.background = 'rgba(15, 23, 42, 0.4)';
    footer.style.backdropFilter = 'blur(8px)';

    // Fallback static time in case API fails or offline
    let displayTime = "Just now";
    let commitLink = "#";
    let commitShaShort = "local";

    const cacheKey = `github_commit_${filename}`;
    const cacheTimeKey = `github_commit_time_${filename}`;
    const cachedData = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);

    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache to avoid rate limit

    if (cachedData && cachedTime && (now - parseInt(cachedTime, 10) < CACHE_DURATION)) {
        try {
            const parsed = JSON.parse(cachedData);
            displayTime = parsed.dateStr;
            commitLink = parsed.url;
            commitShaShort = parsed.shaShort;
        } catch (e) {
            console.error("Failed to parse cached commit data", e);
        }
    } else {
        try {
            const repo = "Yash-007688/premium-qr-generator";
            const response = await fetch(`https://api.github.com/repos/${repo}/commits?path=${filename}&per_page=1`);
            if (response.ok) {
                const commits = await response.ok ? await response.json() : [];
                if (commits && commits.length > 0) {
                    const latestCommit = commits[0];
                    const rawDate = new Date(latestCommit.commit.committer.date);
                    
                    // Format the date beautifully
                    displayTime = rawDate.toLocaleString([], {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                    commitLink = latestCommit.html_url;
                    commitShaShort = latestCommit.sha.substring(0, 7);

                    // Cache it
                    const dataToCache = {
                        dateStr: displayTime,
                        url: commitLink,
                        shaShort: commitShaShort
                    };
                    localStorage.setItem(cacheKey, JSON.stringify(dataToCache));
                    localStorage.setItem(cacheTimeKey, now.toString());
                } else {
                    // Fallback to last repo commit if file-specific commit is empty (e.g. untracked file)
                    const repoResponse = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`);
                    if (repoResponse.ok) {
                        const repoCommits = await repoResponse.json();
                        if (repoCommits && repoCommits.length > 0) {
                            const latestCommit = repoCommits[0];
                            const rawDate = new Date(latestCommit.commit.committer.date);
                            displayTime = rawDate.toLocaleString([], {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                            commitLink = latestCommit.html_url;
                            commitShaShort = latestCommit.sha.substring(0, 7);
                        }
                    }
                }
            }
        } catch (err) {
            console.error("GitHub API fetch failed, using local/cached fallback", err);
            if (cachedData) {
                // If offline but have expired cache, use it
                try {
                    const parsed = JSON.parse(cachedData);
                    displayTime = parsed.dateStr;
                    commitLink = parsed.url;
                    commitShaShort = parsed.shaShort;
                } catch (e) {}
            }
        }
    }

    footer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; justify-content: center;">
            <span>✨ Premium QR Web Studio</span>
            <span style="color: var(--border-color, rgba(255,255,255,0.1));">|</span>
            <span style="display: flex; align-items: center; gap: 0.35rem;">
                🕒 Page Last Updated: <strong style="color: var(--text-main, #f8fafc);">${displayTime}</strong>
            </span>
            <span style="color: var(--border-color, rgba(255,255,255,0.1));">|</span>
            <a href="${commitLink}" target="_blank" style="color: var(--primary, #6366f1); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 0.25rem; transition: color 0.2s ease;">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="display: inline-block; vertical-align: middle;">
                    <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                git ${commitShaShort}
            </a>
        </div>
        <p style="font-size: 0.7rem; color: rgba(148, 163, 184, 0.6); margin-top: 0.25rem;">&copy; ${new Date().getFullYear()} QR Web. All rights reserved.</p>
    `;

    // Add CSS transition/hover styling dynamically
    const link = footer.querySelector('a');
    if (link) {
        link.addEventListener('mouseenter', () => link.style.color = '#818cf8');
        link.addEventListener('mouseleave', () => link.style.color = '#6366f1');
    }
}

// Automatically inject premium GitHub footer on DOM load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLastUpdatedFooter);
} else {
    injectLastUpdatedFooter();
}
