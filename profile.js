// Profile Page Controller
let currentUserId = null;
let currentProfileName = '';

window.addEventListener('DOMContentLoaded', async () => {
    // 1. Verify User Authentication Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.replace('login.html');
        return;
    }
    
    currentUserId = session.user.id;

    // 2. Inject Unified Navigation Dropdown Menu
    await injectUnifiedDropdown('.dashboard-nav');

    // 3. Load User Profile Details
    await loadProfileData();

    // 4. Load Saved Posters History
    await loadPostersHistory();

    // 5. Wire up token pack buy buttons with Razorpay Checkout
    document.querySelectorAll('.pack-buy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pack = btn.dataset.pack;
            const tokens = parseInt(btn.dataset.tokens, 10);
            const price = parseInt(btn.dataset.price, 10);

            const options = {
                key: "rzp_test_yourkeyhere", // Replace with your live / test key from Razorpay Dashboard
                amount: price * 100, // Amount in paise
                currency: "INR",
                name: "QR Web Generator",
                description: `Purchase ${tokens} Tokens - ${pack.toUpperCase()}`,
                image: "logo.png",
                handler: async function (response) {
                    alert(`✅ Payment Successful!\nPayment ID: ${response.razorpay_payment_id}\nUpdating your token balance...`);
                    try {
                        const { tokens: currentBalance } = await getTokenBalance(currentUserId);
                        const newBalance = currentBalance + tokens;
                        const { error } = await supabaseClient
                            .from('profiles')
                            .update({ tokens: newBalance })
                            .eq('id', currentUserId);
                        if (error) throw error;
                        
                        alert(`Successfully added ${tokens} tokens! Your new balance is ${newBalance}.`);
                        await loadProfileData();
                        await injectUnifiedDropdown('.dashboard-nav');
                    } catch (e) {
                        alert("Error updating tokens: " + e.message);
                    }
                },
                prefill: {
                    name: currentProfileName,
                    email: document.getElementById('profile-email-static').innerText
                },
                theme: {
                    color: "#6366f1"
                }
            };

            const rzp = new Razorpay(options);
            rzp.open();
        });
    });

    // Bind Update details form submission
    document.getElementById('profile-form').addEventListener('submit', handleProfileUpdate);
});

// Fetch Profile from DB
async function loadProfileData() {
    try {
        const { data: profile, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', currentUserId)
            .maybeSingle();

        if (error) throw error;

        if (profile) {
            currentProfileName = profile.full_name || '';
            document.getElementById('profile-name-input').value = currentProfileName;
            document.getElementById('profile-email-static').innerText = profile.email || 'N/A';
            document.getElementById('profile-role-static').innerText = profile.role || 'user';
            
            const tierVal = profile.tier || 'free';
            const tierEl = document.getElementById('profile-tier-static');
            if (tierEl) {
                if (tierVal === 'pro') tierEl.innerHTML = 'Pro ✨';
                else if (tierVal === 'enterprise') tierEl.innerHTML = 'Enterprise 🏆';
                else tierEl.innerHTML = 'Free';
            }
            
            // Format Joined Date
            const joinDate = new Date(profile.created_at);
            document.getElementById('profile-joined-static').innerText = joinDate.toLocaleDateString([], {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // Listen for global tierchange to dynamically sync profile tier details
            window.addEventListener('tierchange', (e) => {
                const newTier = e.detail.tier;
                if (tierEl) {
                    if (newTier === 'pro') tierEl.innerHTML = 'Pro ✨';
                    else if (newTier === 'enterprise') tierEl.innerHTML = 'Enterprise 🏆';
                    else tierEl.innerHTML = 'Free';
                }
            });

            // Set Avatar image or letter
            const { data: { session } } = await supabaseClient.auth.getSession();
            const meta = session?.user?.user_metadata || {};
            const avatarUrl = meta.avatar_url || meta.picture || '';
            const avatar = document.getElementById('profile-avatar-icon');
            if (avatar) {
                if (avatarUrl) {
                    avatar.innerHTML = `<img src="${avatarUrl}" class="profile-avatar-img" referrerpolicy="no-referrer">`;
                    avatar.style.padding = '0';
                    avatar.style.background = 'transparent';
                    avatar.style.overflow = 'hidden';
                } else {
                    const firstLetter = (currentProfileName || profile.email || 'U').charAt(0).toUpperCase();
                    avatar.innerText = firstLetter;
                }
            }

            // Status / Last seen
            const statusEl = document.getElementById('profile-status-static');
            if (statusEl) {
                if (profile.status === 'online') {
                    statusEl.innerText = 'Online now';
                } else if (profile.last_seen) {
                    statusEl.innerText = formatTimeAgo(profile.last_seen) + ' ago';
                } else {
                    statusEl.innerText = 'Offline';
                }
            }

            // Token Balance Display
            const tokenBalEl = document.getElementById('profile-token-balance');
            const tokenUsedEl = document.getElementById('profile-tokens-used');
            
            const tokenBalanceInfo = await getTokenBalance(currentUserId);
            if (tokenBalEl) tokenBalEl.innerText = tokenBalanceInfo.tokens;
            if (tokenUsedEl) tokenUsedEl.innerText = tokenBalanceInfo.total_tokens_used;
        }
    } catch (e) {
        console.error("Failed to load user profile:", e);
    }
}

function formatTimeAgo(iso) {
    try {
        const then = new Date(iso).getTime();
        const diff = Math.max(0, Date.now() - then);
        const s = Math.floor(diff / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h`;
        const d = Math.floor(h / 24);
        return `${d}d`;
    } catch (e) {
        return 'unknown';
    }
}

// Poll only the status/last_seen every 30s to keep UI fresh
async function refreshProfileStatus() {
    try {
        if (!currentUserId) return;
        const { data: profile, error } = await supabaseClient.from('profiles').select('status,last_seen').eq('id', currentUserId).maybeSingle();
        if (error || !profile) return;
        const statusEl = document.getElementById('profile-status-static');
        if (!statusEl) return;
        if (profile.status === 'online') statusEl.innerText = 'Online now';
        else if (profile.last_seen) statusEl.innerText = formatTimeAgo(profile.last_seen) + ' ago';
        else statusEl.innerText = 'Offline';
    } catch (e) {
        // ignore
    }
}

// Start polling when page is loaded
setInterval(refreshProfileStatus, 30000);

// Handle Form Submission
async function handleProfileUpdate(e) {
    e.preventDefault();
    
    const newName = document.getElementById('profile-name-input').value.trim();
    if (!newName) return;

    const btn = document.getElementById('update-profile-btn');
    const originalText = btn.innerText;
    btn.innerText = 'Saving Changes...';
    btn.disabled = true;

    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ full_name: newName })
            .eq('id', currentUserId);

        if (error) throw error;

        alert('Profile details updated successfully!');
        
        // Refresh the local state and dropdown UI
        await loadProfileData();
        await injectUnifiedDropdown('.dashboard-nav');
    } catch (err) {
        console.error("Failed to update profile details:", err);
        alert(`Error updating profile: ${err.message}`);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// Fetch Personal Posters
async function loadPostersHistory() {
    const listGrid = document.getElementById('history-grid');
    const emptyState = document.getElementById('history-empty');
    const loadingState = document.getElementById('history-loading');

    listGrid.style.display = 'none';
    emptyState.style.display = 'none';
    loadingState.style.display = 'block';

    try {
        // Fetch Wi-Fi and Hotspot QRs
        const { data: wifiList, error: wifiErr } = await supabaseClient
            .from('wifi_qrs')
            .select('*')
            .eq('user_id', currentUserId);

        if (wifiErr) throw wifiErr;

        // Fetch Link QRs
        const { data: linkList, error: linkErr } = await supabaseClient
            .from('link_qrs')
            .select('*')
            .eq('user_id', currentUserId);

        if (linkErr) throw linkErr;

        // Combine both groups
        let combined = [];

        if (wifiList) {
            wifiList.forEach(item => {
                combined.push({
                    id: item.id,
                    type: item.connection_type === 'hotspot' ? '📱 Hotspot' : '📶 Wi-Fi',
                    date: new Date(item.created_at),
                    target: item.ssid,
                    template: item.template_name,
                    imgData: item.qr_image_data,
                    dbTable: 'wifi_qrs'
                });
            });
        }

        if (linkList) {
            linkList.forEach(item => {
                combined.push({
                    id: item.id,
                    type: '🔗 Link',
                    date: new Date(item.created_at),
                    target: item.url,
                    template: item.template_name,
                    imgData: item.qr_image_data,
                    dbTable: 'link_qrs'
                });
            });
        }

        // Sort by creation date descending
        combined.sort((a, b) => b.date - a.date);

        // Hide loading
        loadingState.style.display = 'none';

        if (combined.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        // Render cards
        listGrid.innerHTML = '';
        combined.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';

            const formattedDate = item.date.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            // Color tag based on type
            const typeColor = item.type.includes('Link') ? '#a855f7' : item.type.includes('Hotspot') ? '#f97316' : '#6366f1';

            // Filename generator
            const safeTarget = item.target.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const cleanType = item.type.split(' ')[1].toLowerCase();
            const filename = `qr_${cleanType}_${safeTarget}_${item.template}.png`;

            card.innerHTML = `
                <div class="hcard-header">
                    <span class="hcard-type" style="color: ${typeColor};">${item.type}</span>
                    <span class="hcard-date">${formattedDate}</span>
                </div>
                <div class="hcard-target" title="${item.target}">${item.target}</div>
                <div class="hcard-details">
                    <span>Style: <strong>${item.template}</strong></span>
                </div>
                <div class="hcard-actions">
                    <button class="action-btn" style="flex:1; padding:0.4rem 0.6rem; font-size:0.8rem;" id="dl-btn-${item.id}">Download</button>
                    <button class="mod-btn mod-btn-danger" style="padding:0.4rem 0.6rem; font-size:0.8rem; margin:0;" id="del-btn-${item.id}">Delete</button>
                </div>
            `;

            listGrid.appendChild(card);

            // Bind download click
            card.querySelector(`#dl-btn-${item.id}`).addEventListener('click', () => {
                if (item.imgData) {
                    downloadFile(item.imgData, filename);
                } else {
                    alert('Poster image data not found.');
                }
            });

            // Bind delete click
            card.querySelector(`#del-btn-${item.id}`).addEventListener('click', () => {
                deletePoster(item.id, item.dbTable);
            });
        });

        listGrid.style.display = 'grid';

    } catch (e) {
        console.error("Failed to load posters history:", e);
        loadingState.innerText = `Error: ${e.message}`;
    }
}

// Download Helper
function downloadFile(base64Data, filename) {
    const link = document.createElement('a');
    link.href = base64Data;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Delete Helper
async function deletePoster(id, dbTable) {
    if (!confirm('Are you sure you want to delete this saved QR poster from your history?')) return;

    try {
        const { error } = await supabaseClient
            .from(dbTable)
            .delete()
            .eq('id', id);

        if (error) throw error;

        alert('Poster successfully deleted.');
        await loadPostersHistory();
    } catch (e) {
        console.error("Failed to delete poster:", e);
        alert(`Error deleting poster: ${e.message}`);
    }
}
