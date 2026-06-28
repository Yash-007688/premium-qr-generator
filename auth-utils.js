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

    await ensureUserTokens(session.user.id);

    // 🪙 Claim today's daily token drip (silent background call — safe net if cron missed)
    (async () => {
        try {
            const { data: dripResult } = await supabaseClient.rpc('claim_daily_drip');
            if (dripResult?.success && dripResult?.granted > 0) {
                // Show a brief toast so user sees their daily tokens
                showDailyDripToast(dripResult.granted, dripResult.balance, dripResult.tier);
            }
        } catch (e) {
            // Non-critical — silently ignore
        }
    })();

    // Attempt to capture user's current public IP
    (async () => {
        try {
            const resp = await fetch('https://api.ipify.org?format=json');
            if (!resp.ok) return;
            const json = await resp.json();
            const ip = json?.ip;
            if (!ip) return;

            // Try to find an existing row for this user/ip
            try {
                const { data: existing, error: selErr } = await supabaseClient
                    .from('user_ips')
                    .select('id, seen_count')
                    .eq('user_id', session.user.id)
                    .eq('ip', ip)
                    .maybeSingle();

                if (selErr) return;

                if (existing && existing.id) {
                    // Update last_seen and increment seen_count
                    await supabaseClient.from('user_ips').update({
                        last_seen: new Date().toISOString(),
                        seen_count: (existing.seen_count || 0) + 1
                    }).eq('id', existing.id);
                } else {
                    // Insert a new row
                    await supabaseClient.from('user_ips').insert([
                        {
                            user_id: session.user.id,
                            ip: ip,
                            first_seen: new Date().toISOString(),
                            last_seen: new Date().toISOString(),
                            seen_count: 1
                        }
                    ]);
                }
            } catch (e) {
                // ignore errors
            }
        } catch (e) {
            // network or other error - ignore to avoid blocking login
        }
    })();

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

// === TOKEN SYSTEM HELPERS ===
async function syncTokensToProfile(userId, balance, totalSpent) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({
            tokens: balance,
            total_tokens_used: totalSpent
        })
        .eq('id', userId);

    if (error) {
        console.error('syncTokensToProfile failed:', error.message);
        return { success: false, error: error.message };
    }
    return { success: true, error: null };
}

async function ensureUserTokens(userId, startingBalance = 100) {
    try {
        const { data: profile } = await supabaseClient
            .from('profiles')
            .select('tokens, total_tokens_used')
            .eq('id', userId)
            .maybeSingle();

        const { data: tokenRow } = await supabaseClient
            .from('user_tokens')
            .select('balance, total_spent')
            .eq('user_id', userId)
            .maybeSingle();

        if (tokenRow) {
            const balance = tokenRow.balance ?? 0;
            const spent = tokenRow.total_spent ?? 0;
            await syncTokensToProfile(userId, balance, spent);
            return { success: true, balance, totalSpent: spent };
        }

        const balance = profile?.tokens ?? startingBalance;
        const spent = profile?.total_tokens_used ?? 0;

        const { error } = await supabaseClient.from('user_tokens').upsert(
            {
                user_id: userId,
                balance,
                total_spent: spent
            },
            { onConflict: 'user_id' }
        );

        if (error) {
            console.error('ensureUserTokens failed:', error.message);
            return { success: false, error: error.message };
        }

        await syncTokensToProfile(userId, balance, spent);
        return { success: true, balance, totalSpent: spent };
    } catch (e) {
        console.error('ensureUserTokens failed:', e);
        return { success: false, error: e.message };
    }
}

async function getTokenBalance(userId) {
    try {
        await ensureUserTokens(userId);
        const { data, error } = await supabaseClient
            .from('user_tokens')
            .select('balance, total_spent')
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !data) return { tokens: 0, total_tokens_used: 0 };
        return { tokens: data.balance ?? 0, total_tokens_used: data.total_spent ?? 0 };
    } catch (e) {
        console.error('Failed to fetch token balance:', e);
        return { tokens: 0, total_tokens_used: 0 };
    }
}

async function deductTokens(userId, amount) {
    try {
        await ensureUserTokens(userId);
        const { tokens: currentBalance } = await getTokenBalance(userId);
        if (currentBalance < amount) {
            return { success: false, newBalance: currentBalance, error: 'Insufficient tokens' };
        }
        const newBalance = currentBalance - amount;
        const { data: userTokenRow } = await supabaseClient
            .from('user_tokens')
            .select('total_spent')
            .eq('user_id', userId)
            .maybeSingle();
        const currentUsed = userTokenRow?.total_spent ?? 0;
        const { error } = await supabaseClient
            .from('user_tokens')
            .upsert(
                { user_id: userId, balance: newBalance, total_spent: currentUsed + amount },
                { onConflict: 'user_id' }
            );
        if (error) return { success: false, newBalance: currentBalance, error: error.message };

        await syncTokensToProfile(userId, newBalance, currentUsed + amount);

        if (typeof updateNavbarTokenBadge === 'function') {
            updateNavbarTokenBadge(newBalance);
        }
        return { success: true, newBalance, error: null };
    } catch (e) {
        console.error('Failed to deduct tokens:', e);
        return { success: false, newBalance: 0, error: e.message };
    }
}

async function addTokens(userId, amount) {
    try {
        await ensureUserTokens(userId);
        const { tokens: currentBalance } = await getTokenBalance(userId);
        const newBalance = currentBalance + amount;
        const { data: userTokenRow } = await supabaseClient
            .from('user_tokens')
            .select('total_spent')
            .eq('user_id', userId)
            .maybeSingle();
        const { error } = await supabaseClient
            .from('user_tokens')
            .upsert(
                {
                    user_id: userId,
                    balance: newBalance,
                    total_spent: userTokenRow?.total_spent ?? 0
                },
                { onConflict: 'user_id' }
            );
        if (error) return { success: false, newBalance: currentBalance, error: error.message };

        const totalSpent = userTokenRow?.total_spent ?? 0;
        await syncTokensToProfile(userId, newBalance, totalSpent);

        if (typeof updateNavbarTokenBadge === 'function') {
            updateNavbarTokenBadge(newBalance);
        }
        return { success: true, newBalance, error: null };
    } catch (e) {
        console.error('Failed to add tokens:', e);
        return { success: false, newBalance: 0, error: e.message };
    }
}

async function setUserTokenBalance(userId, newBalance) {
    try {
        const balance = Math.max(0, newBalance);
        await ensureUserTokens(userId, balance);

        const { data: tokenRow } = await supabaseClient
            .from('user_tokens')
            .select('total_spent')
            .eq('user_id', userId)
            .maybeSingle();
        const totalSpent = tokenRow?.total_spent ?? 0;

        const { error } = await supabaseClient
            .from('user_tokens')
            .upsert(
                { user_id: userId, balance, total_spent: totalSpent },
                { onConflict: 'user_id' }
            );
        if (error) return { success: false, newBalance: balance, error: error.message };

        await syncTokensToProfile(userId, balance, totalSpent);
        return { success: true, newBalance: balance, totalSpent, error: null };
    } catch (e) {
        console.error('Failed to set token balance:', e);
        return { success: false, newBalance: 0, error: e.message };
    }
}

const PLAN_TIER_CONFIG = {
    free:       { tokens: 3000,   dailyDrip: 100,   amount: 0,    label: 'Free Plan' },
    pro:        { tokens: 90000,  dailyDrip: 3000,  amount: 799,  label: 'Pro Subscription' },
    enterprise: { tokens: 500000, dailyDrip: 16667, amount: 3999, label: 'Enterprise Subscription' }
};

function getPlanTokensForTier(tier) {
    return PLAN_TIER_CONFIG[tier]?.tokens ?? PLAN_TIER_CONFIG.free.tokens;
}

async function applyUserTierPlan(userId, tier, options = {}) {
    try {
        const { data, error } = await supabaseClient.rpc('apply_user_tier_plan', {
            p_user_id: userId,
            p_tier: tier,
            p_source: options.source || 'system',
            p_amount: options.amount ?? null,
            p_razorpay_payment_id: options.razorpayPaymentId ?? null,
            p_razorpay_order_id: options.razorpayOrderId ?? null,
            p_plan_suffix: options.planSuffix ?? null
        });

        if (error) {
            console.error('applyUserTierPlan failed:', error.message);
            return { success: false, error: error.message };
        }

        const result = data || {};
        if (typeof updateNavbarTokenBadge === 'function' && result.tokens != null) {
            updateNavbarTokenBadge(result.tokens);
        }

        return {
            success: true,
            tier: result.tier || tier,
            tokens: result.tokens ?? getPlanTokensForTier(tier),
            unchanged: !!result.unchanged,
            error: null
        };
    } catch (e) {
        console.error('applyUserTierPlan failed:', e);
        return { success: false, error: e.message };
    }
}

async function recordAdminTokenAdjustment(userId, adjustBy, note) {
    if (!adjustBy) return { success: true };
    const planName = note?.trim()
        ? `Manual Token Adjustment — ${note.trim()}`
        : `Manual Token Adjustment (${adjustBy > 0 ? '+' : ''}${adjustBy})`;

    const { error } = await supabaseClient.from('payments').insert({
        user_id: userId,
        plan_name: planName,
        tokens_purchased: adjustBy,
        amount: 0,
        payment_gateway: 'admin_manual',
        status: 'success',
        updated_at: new Date().toISOString()
    });

    if (error) {
        console.error('recordAdminTokenAdjustment failed:', error.message);
        return { success: false, error: error.message };
    }
    return { success: true, error: null };
}

function updateNavbarTokenBadge(balance, tier) {
    const badge = document.getElementById('navbar-token-badge');
    if (!badge) return;
    const countEl = badge.querySelector('.token-count');
    if (countEl) {
        // Format large numbers nicely: 3000 → 3K, 90000 → 90K
        if (balance >= 1000) {
            countEl.textContent = (balance / 1000).toFixed(balance % 1000 === 0 ? 0 : 1) + 'K';
        } else {
            countEl.textContent = balance;
        }
    }
    // Scale the low-balance warning based on tier
    const lowThreshold = tier === 'enterprise' ? 5000 : tier === 'pro' ? 500 : 50;
    if (balance < lowThreshold) {
        badge.classList.add('low-balance');
    } else {
        badge.classList.remove('low-balance');
    }
    // Trigger deduction animation
    badge.classList.add('deducting');
    setTimeout(() => badge.classList.remove('deducting'), 600);
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
            .select('id, full_name, role, is_banned, ban_reason, ban_type, banned_until, tier')
            .eq('id', session.user.id)
            .maybeSingle();

        const check = await checkAndEnforceBanExpiry(profile, session);
        if (check.isBanned) return;

        const activeProfile = check.profile;
        const fullName = activeProfile?.full_name || session.user.email.split('@')[0];
        const isAdmin = activeProfile?.role === 'admin';
        const userTier = activeProfile?.tier || 'free';

        const meta = session.user.user_metadata || {};
        const avatarUrl = meta.avatar_url || meta.picture || '';
        let avatarHtml = '👤 ';
        if (avatarUrl) {
            avatarHtml = `<img src="${avatarUrl}" class="nav-avatar" referrerpolicy="no-referrer"> `;
        }

        // Create unified glassmorphic dropdown container
        const dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'profile-dropdown-container';
        dropdownContainer.style.display = 'flex';
        dropdownContainer.style.alignItems = 'center';
        dropdownContainer.style.gap = '0.8rem';

        const adminItem = isAdmin ? `<a class="dropdown-item" href="admin.html">✨ Admin Panel</a>` : '';

        dropdownContainer.innerHTML = `
            <button id="nav-theme-toggle" class="nav-theme-toggle-btn" aria-label="Toggle theme">
                <span class="theme-icon-light">☀️</span>
                <span class="theme-icon-dark">🌙</span>
            </button>
            <div class="profile-trigger-wrapper" style="position: relative; display: inline-block;">
                <div class="profile-trigger" id="profile-trigger-btn">
                    ${avatarHtml}
                    <span>${fullName}</span>
                    <span class="arrow">▼</span>
                </div>
                <div class="dropdown-menu" id="profile-dropdown-menu">
                    <a class="dropdown-item" href="index.html">🏠 Home Page</a>
                    <a class="dropdown-item" href="profile.html">👤 My Profile</a>
                    <a class="dropdown-item" href="dashboard.html?studio=1">📶 Creator Studio</a>
                    ${adminItem}
                    <div class="dropdown-divider"></div>
                    <div class="dropdown-item logout" id="dropdown-logout-btn">🚪 Log Out</div>
                </div>
            </div>
        `;

        // Adapt navigation injection depending on the target navbar selector
        if (containerSelector === '.nav-links') {
            // Also update profiles table to mark user as online and set last_seen
            (async () => {
                try {
                    await supabaseClient.from('profiles').update({
                        last_seen: new Date().toISOString(),
                        status: 'online'
                    }).eq('id', session.user.id);
                } catch (e) {
                    // ignore
                }
            })();
            container.appendChild(dropdownContainer);
        } else if (containerSelector === '.dashboard-nav') {
            // Studio/Admin/Profile navbars - keep logo and nav-toggle, replace others inside nav-links
            const navLinks = container.querySelector('.nav-links');
            if (navLinks) {
                navLinks.innerHTML = '';
                navLinks.appendChild(dropdownContainer);
            } else {
                container.appendChild(dropdownContainer);
            }
        } else {
            container.appendChild(dropdownContainer);
        }

        // Bind dropdown toggles
        const trigger = dropdownContainer.querySelector('#profile-trigger-btn');
        const menu = dropdownContainer.querySelector('#profile-dropdown-menu');
        const themeBtn = dropdownContainer.querySelector('#nav-theme-toggle');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            trigger.classList.toggle('active');
            menu.classList.toggle('show');
        });

        // Click outside to close
        document.addEventListener('click', () => {
            if (trigger) trigger.classList.remove('active');
            if (menu) menu.classList.remove('show');
        });

        // Handle Theme Toggle inside navigation
        if (themeBtn) {
            themeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentTheme = localStorage.getItem('theme') || 'dark';
                if (currentTheme === 'light') {
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('theme', 'dark');
                } else {
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.setItem('theme', 'light');
                }
                // Sync page checkbox if it exists
                const checkbox = document.getElementById('theme-checkbox');
                if (checkbox) {
                    checkbox.checked = (localStorage.getItem('theme') === 'light');
                }
                // Dispatch global event for reactive systems (e.g. charts)
                window.dispatchEvent(new Event('themechange'));
            });
        }

        // Handle Logout inside dropdown
        dropdownContainer.querySelector('#dropdown-logout-btn').addEventListener('click', async (e) => {
            e.preventDefault();
            if (typeof window.handleLogout === 'function') {
                return window.handleLogout();
            }
            try {
                sessionStorage.clear();
                localStorage.clear();
                if (supabaseClient && supabaseClient.auth && typeof supabaseClient.auth.signOut === 'function') {
                    await supabaseClient.auth.signOut();
                }
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
    const getRepoRelativePath = (urlPath) => {
        if (!urlPath) return null;
        const noQuery = urlPath.replace(/[?#].*$/, '');
        const trimmed = noQuery.replace(/\/+$|^\//g, '');
        if (!trimmed) return 'index.html';
        return trimmed;
    };

    const getResourceFilenameFromUrl = (url) => {
        try {
            const parsed = new URL(url, window.location.href);
            if (parsed.origin !== window.location.origin) return null;
            return getRepoRelativePath(parsed.pathname);
        } catch (e) {
            return null;
        }
    };

    const isTrackableFile = (filePath) => {
        return typeof filePath === 'string' && filePath.trim() !== '';
    };

    const addTrackedResource = (url) => {
        const resourcePath = getResourceFilenameFromUrl(url);
        if (isTrackableFile(resourcePath)) {
            trackedFilenames.add(resourcePath);
        }
    };

    const trackedFilenames = new Set();

    // Current page path
    const pagePath = getRepoRelativePath(window.location.pathname);
    if (isTrackableFile(pagePath)) trackedFilenames.add(pagePath || 'index.html');

    // Track local JS, CSS, image, video, audio, and generic resource files loaded by the page
    document.querySelectorAll('[src], link[href]').forEach((element) => {
        if (element.tagName === 'LINK') {
            addTrackedResource(element.href);
        } else {
            addTrackedResource(element.src || element.href);
        }
    });

    // Track any file references that may be manually registered on the page
    if (Array.isArray(window.SYNC_PAGE_TIMESTAMP_FILES)) {
        window.SYNC_PAGE_TIMESTAMP_FILES.forEach((file) => {
            const normalized = getRepoRelativePath(file);
            if (isTrackableFile(normalized)) trackedFilenames.add(normalized);
        });
    }

    const filenames = [...trackedFilenames];

    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    const repo = "Yash-007688/premium-qr-generator";

    const getCacheKey = (filePath) => `github_commit_${filePath}`;
    const getCacheTimeKey = (filePath) => `github_commit_time_${filePath}`;

    const fetchGitHubCommitForFile = async (filePath) => {
        const cacheKey = getCacheKey(filePath);
        const cacheTimeKey = getCacheTimeKey(filePath);
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTime = localStorage.getItem(cacheTimeKey);

        if (cachedData && cachedTime && (now - parseInt(cachedTime, 10) < CACHE_DURATION)) {
            try {
                const parsed = JSON.parse(cachedData);
                return {
                    lastUpdatedAt: parsed.dateISO,
                    commitSha: parsed.sha,
                    commitUrl: parsed.url
                };
            } catch (e) {
                console.error("Failed to parse cached commit data", e);
            }
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${repo}/commits?path=${filePath}&per_page=1`);
            if (response.ok) {
                const commits = await response.json();
                if (commits && commits.length > 0) {
                    const latestCommit = commits[0];
                    const result = {
                        lastUpdatedAt: latestCommit.commit.committer.date,
                        commitSha: latestCommit.sha,
                        commitUrl: latestCommit.html_url,
                        commitMessage: latestCommit.commit && latestCommit.commit.message ? latestCommit.commit.message : null
                    };
                    localStorage.setItem(cacheKey, JSON.stringify(result));
                    localStorage.setItem(cacheTimeKey, now.toString());
                    return result;
                }
            }
        } catch (err) {
            console.error("GitHub API fetch failed:", err);
        }

        return null;
    };

    if (typeof supabaseClient !== 'undefined') {
        for (const filePath of filenames) {
            try {
                const commitData = await fetchGitHubCommitForFile(filePath);
                if (!commitData) continue;

                await supabaseClient.from('page_timestamps').upsert(
                    {
                        page_name: filePath,
                        last_updated_at: commitData.lastUpdatedAt,
                        commit_sha: commitData.commitSha,
                        commit_url: commitData.commitUrl,
                        commit_name: commitData.commitMessage || null,
                        updated_at: new Date().toISOString()
                    },
                    { onConflict: 'page_name' }
                );
            } catch (e) {
                console.error(`Failed to sync timestamp for ${filePath}:`, e);
            }
        }
    }
}

// Global logout helper used by dropdown and mobile menus
window.handleLogout = async function() {
    try {
        // Mark user offline before signing out
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session && session.user && session.user.id) {
                await supabaseClient.from('profiles').update({
                    last_seen: new Date().toISOString(),
                    status: 'offline'
                }).eq('id', session.user.id);
            }
        } catch (e) {
            // ignore
        }

        sessionStorage.clear();
        localStorage.clear();
        if (typeof supabaseClient !== 'undefined' && supabaseClient?.auth?.signOut) {
            await supabaseClient.auth.signOut();
        }
    } catch (e) {
        console.error('Logout failed:', e);
    }
    window.location.href = 'index.html';
};

// Automatically sync timestamp on DOM load (silently, no UI)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncPageTimestampToSupabase);
} else {
    syncPageTimestampToSupabase();
}

// Presence heartbeat: periodically update profiles.last_seen and status
function startPresenceHeartbeat() {
    let intervalId = null;

    const sendHeartbeat = async () => {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) return;
            await supabaseClient.from('profiles').update({
                last_seen: new Date().toISOString(),
                status: 'online'
            }).eq('id', session.user.id);
        } catch (e) {
            // ignore
        }
    };

    document.addEventListener('visibilitychange', async () => {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) return;
            if (document.visibilityState === 'visible') {
                await supabaseClient.from('profiles').update({ last_seen: new Date().toISOString(), status: 'online' }).eq('id', session.user.id);
            } else {
                await supabaseClient.from('profiles').update({ last_seen: new Date().toISOString(), status: 'offline' }).eq('id', session.user.id);
            }
        } catch (e) {}
    });

    window.addEventListener('beforeunload', async () => {
        try {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                await supabaseClient.from('profiles').update({ last_seen: new Date().toISOString(), status: 'offline' }).eq('id', session.user.id);
            }
        } catch (e) {}
    });

    // start immediately and repeat every 30s
    sendHeartbeat();
    intervalId = setInterval(sendHeartbeat, 30000);

    // expose stop handle
    window.__presenceHeartbeat = { stop: () => clearInterval(intervalId) };
}

// Start presence heartbeat on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPresenceHeartbeat);
} else {
    startPresenceHeartbeat();
}

// ─────────────────────────────────────────────────────────────
// 🪙 DAILY DRIP TOAST — shows when tokens are granted on login
// ─────────────────────────────────────────────────────────────
function showDailyDripToast(granted, balance, tier) {
    // Remove any existing drip toast
    const old = document.getElementById('daily-drip-toast');
    if (old) old.remove();

    const tierColors = {
        enterprise: { from: '#f59e0b', to: '#ef4444', icon: '👑' },
        pro:        { from: '#818cf8', to: '#c084fc', icon: '⚡' },
        free:       { from: '#34d399', to: '#22c55e', icon: '🪙' }
    };
    const t = tierColors[tier] || tierColors.free;

    // Format numbers
    const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K' : n;

    const toast = document.createElement('div');
    toast.id = 'daily-drip-toast';
    toast.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.75rem;">
            <span style="font-size:1.5rem;animation:dripBounce 0.6s ease;">${t.icon}</span>
            <div>
                <div style="font-weight:700;font-size:0.9rem;color:#fff;letter-spacing:0.3px;">
                    Daily Tokens Received!
                </div>
                <div style="font-size:0.75rem;color:rgba(255,255,255,0.75);margin-top:1px;">
                    +${fmt(granted)} tokens added · Balance: <strong style="color:#fff">${fmt(balance)}</strong>
                </div>
            </div>
        </div>
        <button onclick="document.getElementById('daily-drip-toast').remove()"
                style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:1rem;padding:0 0 0 0.5rem;line-height:1;">✕</button>
    `;

    Object.assign(toast.style, {
        position:        'fixed',
        bottom:          '1.5rem',
        right:           '1.5rem',
        zIndex:          '99999',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        gap:             '1rem',
        padding:         '0.85rem 1.1rem',
        borderRadius:    '14px',
        background:      `linear-gradient(135deg, ${t.from}22, ${t.to}22)`,
        border:          `1px solid ${t.from}55`,
        backdropFilter:  'blur(12px)',
        boxShadow:       `0 8px 32px ${t.from}33, 0 2px 8px rgba(0,0,0,0.4)`,
        minWidth:        '280px',
        maxWidth:        '340px',
        animation:       'dripSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
        fontFamily:      "'Inter', sans-serif"
    });

    // Inject keyframes once
    if (!document.getElementById('drip-toast-styles')) {
        const style = document.createElement('style');
        style.id = 'drip-toast-styles';
        style.textContent = `
            @keyframes dripSlideIn {
                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                to   { opacity: 1; transform: translateY(0)   scale(1);    }
            }
            @keyframes dripSlideOut {
                from { opacity: 1; transform: translateY(0)   scale(1);    }
                to   { opacity: 0; transform: translateY(20px) scale(0.95); }
            }
            @keyframes dripBounce {
                0%,100% { transform: translateY(0); }
                40%     { transform: translateY(-6px); }
                70%     { transform: translateY(-3px); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-dismiss after 5s with slide-out animation
    setTimeout(() => {
        if (!toast.parentNode) return;
        toast.style.animation = 'dripSlideOut 0.35s ease forwards';
        setTimeout(() => toast.remove(), 350);
    }, 5000);
}

