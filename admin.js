// Global Chart instances to avoid overlaps when redrawing
let qrActivityChart = null;
let qrTypeChart = null;

// Store fetched database results globally to support live filtering/sorting without re-fetching
let globalAuthData = [];
let globalWifiData = [];
let globalLinkData = [];
let globalPaymentData = [];

// Keep track of user being banned / token-edited
let activeBanUserId = null;
let activeTokenUserId = null;
let activeTokenCurrentBalance = 0;

// Protect Admin Page (admins only)
window.addEventListener('DOMContentLoaded', async () => {
    const isAdmin = await requireAdmin();
    if (!isAdmin) return;

    // Inject the Unified Glassmorphic Profile Dropdown
    await injectUnifiedDropdown('.dashboard-nav');
    
    // Bind controls
    document.getElementById('refresh-btn').addEventListener('click', fetchData);
    document.getElementById('graph-time-range').addEventListener('change', processAndDrawCharts);
    document.getElementById('graph-sort-order').addEventListener('change', processAndDrawCharts);
    window.addEventListener('themechange', processAndDrawCharts);

    // --- Token Modal Wiring ---
    document.getElementById('token-cancel-btn').addEventListener('click', () => {
        document.getElementById('token-modal-overlay').classList.remove('show');
        activeTokenUserId = null;
    });

    document.getElementById('token-confirm-btn').addEventListener('click', adjustUserTokens);

    // Bind Advanced Ban Modal Interactivity
    const modalOverlay = document.getElementById('ban-modal-overlay');
    const reasonSelect = document.getElementById('ban-reason-select');
    const customReasonContainer = document.getElementById('custom-reason-container');
    const customReasonTextarea = document.getElementById('ban-reason-custom');
    const durationRadioGroup = document.getElementsByName('ban-duration-type');
    const durationDaysContainer = document.getElementById('temporary-duration-container');
    const expiryDatetimeInput = document.getElementById('ban-expiry-datetime');
    const cancelBtn = document.getElementById('ban-cancel-btn');
    const confirmBtn = document.getElementById('ban-confirm-btn');

    // Show custom textarea conditionally
    reasonSelect.addEventListener('change', () => {
        if (reasonSelect.value === 'CUSTOM') {
            customReasonContainer.style.display = 'flex';
        } else {
            customReasonContainer.style.display = 'none';
        }
    });

    // Show temporary duration days input conditionally
    durationRadioGroup.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'temporary') {
                durationDaysContainer.style.display = 'flex';
            } else {
                durationDaysContainer.style.display = 'none';
            }
        });
    });

    // Close modal on Cancel
    cancelBtn.addEventListener('click', () => {
        modalOverlay.classList.remove('show');
        activeBanUserId = null;
    });

    // Handle Confirm Ban Submit
    confirmBtn.addEventListener('click', async () => {
        if (!activeBanUserId) return;

        let finalReason = reasonSelect.value;
        if (finalReason === 'CUSTOM') {
            finalReason = customReasonTextarea.value.trim() || 'Custom suspension';
        }

        let isTemporary = false;
        durationRadioGroup.forEach(radio => {
            if (radio.checked && radio.value === 'temporary') isTemporary = true;
        });

        let bannedUntil = null;
        let banType = 'permanent';

        if (isTemporary) {
            banType = 'temporary';
            const datetimeVal = expiryDatetimeInput.value;
            if (datetimeVal) {
                bannedUntil = new Date(datetimeVal).toISOString();
            } else {
                const fallback = new Date();
                fallback.setHours(fallback.getHours() + 1);
                bannedUntil = fallback.toISOString();
            }
        }

        confirmBtn.disabled = true;
        confirmBtn.innerText = 'Suspending...';

        try {
            const { error } = await supabaseClient
                .from('profiles')
                .update({
                    is_banned: true,
                    ban_reason: finalReason,
                    ban_type: banType,
                    banned_until: bannedUntil
                })
                .eq('id', activeBanUserId);

            if (error) throw error;

            alert('User profile has been successfully suspended.');
            modalOverlay.classList.remove('show');
            activeBanUserId = null;
            fetchData();
        } catch (err) {
            console.error("Failed to execute suspend query:", err);
            alert(`Error executing ban action: ${err.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerText = 'Confirm Ban';
        }
    });

    fetchData();
});

async function fetchData() {
    // Show loading states in tables
    document.getElementById('auth-table-body').innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
    document.getElementById('wifi-table-body').innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
    document.getElementById('link-table-body').innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';
    document.getElementById('payment-table-body').innerHTML = '<tr><td colspan="8" class="empty-state">Loading...</td></tr>';

    try {
        // 1. Fetch Profiles (Auth) Data
        const { data: authData, error: authError } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (authError) throw authError;

        // Fetch User Tokens separately
        const { data: tokenData, error: tokenError } = await supabaseClient
            .from('user_tokens')
            .select('user_id, balance, total_spent');

        if (tokenError) {
            console.warn('user_tokens fetch warning:', tokenError.message);
        }

        // Merge tokens into authData (user_tokens first, then profiles fallback)
        const tokenMap = {};
        if (tokenData) {
            tokenData.forEach(t => {
                tokenMap[t.user_id] = t;
            });
        }

        globalAuthData = (authData || []).map(u => ({
            ...u,
            tokens: tokenMap[u.id]?.balance ?? u.tokens ?? 20,
            total_tokens_used: tokenMap[u.id]?.total_spent ?? u.total_tokens_used ?? 0
        }));

        // 2. Fetch Wi-Fi & Hotspot Data
        const { data: wifiData, error: wifiError } = await supabaseClient
            .from('wifi_qrs')
            .select('*, profiles(full_name, email)')
            .order('created_at', { ascending: false });

        if (wifiError) throw wifiError;
        globalWifiData = wifiData || [];

        // 3. Fetch Link Data
        const { data: linkData, error: linkError } = await supabaseClient
            .from('link_qrs')
            .select('*, profiles(full_name, email)')
            .order('created_at', { ascending: false });

        if (linkError) throw linkError;
        globalLinkData = linkData || [];

        // 4. Fetch Payments Data (graceful — table may not exist yet)
        try {
            const { data: payData, error: payError } = await supabaseClient
                .from('payments')
                .select('*, profiles(full_name, email)')
                .order('created_at', { ascending: false });
            if (!payError) globalPaymentData = payData || [];
        } catch (_) {
            globalPaymentData = [];
        }

        // Update Overview Cards
        updateMetricCards();

        // Render Tables
        renderAuthTable(globalAuthData);
        renderWifiTable(globalWifiData);
        renderLinkTable(globalLinkData);
        renderPaymentTable(globalPaymentData);

        // Process and Draw Analytics Charts
        processAndDrawCharts();

    } catch (e) {
        console.error("Error fetching data:", e);
        const errMsg = `<tr><td colspan="6" class="empty-state" style="color:#ef4444; font-weight:600;">
            Database Error: ${e.message || "Please run the migration SQL script in Supabase first."}
        </td></tr>`;
        document.getElementById('auth-table-body').innerHTML = errMsg;
        document.getElementById('wifi-table-body').innerHTML = errMsg;
        document.getElementById('link-table-body').innerHTML = errMsg;
        document.getElementById('payment-table-body').innerHTML = errMsg;
    }
}

function updateMetricCards() {
    // Total Users
    document.getElementById('stat-total-users').innerText = globalAuthData.length;
    
    // Wi-Fi vs Hotspot QRs
    const wifiCount = globalWifiData.filter(row => row.connection_type !== 'hotspot').length;
    const hotspotCount = globalWifiData.filter(row => row.connection_type === 'hotspot').length;
    document.getElementById('stat-wifi-qrs').innerText = wifiCount;
    document.getElementById('stat-hotspot-qrs').innerText = hotspotCount;
    
    // Total Link QRs
    document.getElementById('stat-link-qrs').innerText = globalLinkData.length;

    // Total Tokens Issued (sum of all user balances)
    const totalTokens = globalAuthData.reduce((sum, u) => sum + (u.tokens || 0), 0);
    document.getElementById('stat-total-tokens').innerText = totalTokens;

    // Total Revenue from successful payments
    const totalRevenue = globalPaymentData
        .filter(p => p.status === 'success')
        .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    document.getElementById('stat-total-revenue').innerText = '\u20b9' + totalRevenue.toFixed(0);
}

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const d = new Date(isoString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

// === GRAPH PROCESSING AND CHART.JS RENDERING ===
function processAndDrawCharts() {
    const rangeVal = document.getElementById('graph-time-range').value;
    const sortVal = document.getElementById('graph-sort-order').value;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const textColor = isLight ? '#475569' : '#94a3b8';
    const gridColor = isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.05)';
    const borderColor = isLight ? '#ffffff' : '#1e293b';

    const now = new Date();
    let thresholdDate = null;
    if (rangeVal === '7') {
        thresholdDate = new Date();
        thresholdDate.setDate(now.getDate() - 7);
    } else if (rangeVal === '30') {
        thresholdDate = new Date();
        thresholdDate.setDate(now.getDate() - 30);
    }

    // 1. Process QR Generation Activity Over Time
    const activityMap = {};

    const processQREntry = (row) => {
        const createdDate = new Date(row.created_at);
        if (thresholdDate && createdDate < thresholdDate) return;
        
        // Group by Date String: YYYY-MM-DD
        const dateKey = createdDate.toISOString().split('T')[0];
        activityMap[dateKey] = (activityMap[dateKey] || 0) + 1;
    };

    globalWifiData.forEach(processQREntry);
    globalLinkData.forEach(processQREntry);

    // Get sorted keys
    let dates = Object.keys(activityMap);
    dates.sort((a, b) => {
        const d1 = new Date(a);
        const d2 = new Date(b);
        return sortVal === 'asc' ? d1 - d2 : d2 - d1;
    });

    // If no data exists, provide fallback
    if (dates.length === 0) {
        dates = ['No Data'];
        activityMap['No Data'] = 0;
    }

    const activityCounts = dates.map(d => activityMap[d]);
    // Make dates more readable on chart labels
    const formattedLabels = dates.map(d => {
        if (d === 'No Data') return d;
        const parts = d.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        return dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
    });

    // 2. Process QR Type Distribution
    let wifiCount = 0;
    let hotspotCount = 0;
    let linkCount = 0;

    globalWifiData.forEach(row => {
        const createdDate = new Date(row.created_at);
        if (thresholdDate && createdDate < thresholdDate) return;
        if (row.connection_type === 'hotspot') {
            hotspotCount++;
        } else {
            wifiCount++;
        }
    });

    globalLinkData.forEach(row => {
        const createdDate = new Date(row.created_at);
        if (thresholdDate && createdDate < thresholdDate) return;
        linkCount++;
    });

    // Destroy previous Chart instances to prevent canvas artifacts
    if (qrActivityChart) qrActivityChart.destroy();
    if (qrTypeChart) qrTypeChart.destroy();

    // Chart A: Activity Over Time (glowing line chart)
    const ctxA = document.getElementById('qr-generation-chart').getContext('2d');
    qrActivityChart = new Chart(ctxA, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: [{
                label: 'QR Posters Generated',
                data: activityCounts,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: '#818cf8',
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, stepSize: 1, precision: 0 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor }
                }
            }
        }
    });

    // Chart B: QR Code Types Distribution (doughnut chart)
    const ctxB = document.getElementById('qr-distribution-chart').getContext('2d');
    qrTypeChart = new Chart(ctxB, {
        type: 'doughnut',
        data: {
            labels: ['📶 Wi-Fi', '📱 Hotspot', '🔗 Link'],
            datasets: [{
                data: [wifiCount, hotspotCount, linkCount],
                backgroundColor: ['#6366f1', '#f97316', '#a855f7'],
                borderColor: borderColor,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: textColor, font: { size: 11, weight: '500' } }
                }
            },
            cutout: '65%'
        }
    });
}

// === TABLE RENDERING ===

function renderAuthTable(data) {
    const tbody = document.getElementById('auth-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No users registered yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const role = row.role || 'user';
        const roleLabel = role === 'admin' ? 'Admin' : 'User';
        const roleColor = role === 'admin' ? '#f97316' : 'var(--text-muted)';
        
        const statusBadge = row.is_banned 
            ? `<span class="badge badge-banned">Banned</span>` 
            : `<span class="badge badge-active">Active</span>`;

        const banActionText = row.is_banned ? 'Unban' : 'Ban';
        const banActionClass = row.is_banned ? 'mod-btn-success' : 'mod-btn-warning';

        // Token display with edit button
        const tokenBal = row.tokens ?? 20;
        const tokenCell = `<span style="color:#fb923c; font-weight:700;">${tokenBal}</span>
            <button class="mod-btn" style="padding:0.2rem 0.5rem; font-size:0.72rem; margin-left:0.35rem; background:rgba(99,102,241,0.15); border-color:rgba(99,102,241,0.3); color:#a5b4fc;"
                onclick="editUserTokens('${row.id}', '${(row.full_name || row.email || 'User').replace(/'/g, "\\'")}', ${tokenBal})">✏️ Edit</button>`;

        tr.innerHTML = `
            <td><strong>${row.full_name || 'N/A'}</strong></td>
            <td><a href="mailto:${row.email}" style="color:var(--primary); text-decoration:none;">${row.email}</a></td>
            <td><span style="color:${roleColor}; font-weight:600; text-transform:capitalize;">${roleLabel}</span></td>
            <td>${tokenCell}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="mod-btn ${banActionClass}" onclick="toggleBanUser('${row.id}', ${row.is_banned})">${banActionText}</button>
                <button class="mod-btn mod-btn-danger" onclick="deleteUser('${row.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderWifiTable(data) {
    const tbody = document.getElementById('wifi-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No Wi-Fi or Hotspot QR codes generated yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const creatorName = row.profiles?.full_name || row.profiles?.email || 'Unknown User';
        const connType = row.connection_type || 'wifi';
        const typeLabel = connType === 'hotspot' ? '📱 Hotspot' : '📶 Wi-Fi';
        const typeColor = connType === 'hotspot' ? '#f97316' : 'var(--primary)';
        
        tr.innerHTML = `
            <td>${formatDate(row.created_at)}</td>
            <td><span style="color:var(--text-muted); font-size:0.85rem;">${creatorName}</span></td>
            <td><span style="color:${typeColor}; font-weight:600;">${typeLabel}</span></td>
            <td><strong>${row.ssid}</strong></td>
            <td><span style="text-transform: capitalize;">${row.template_name}</span></td>
            <td>
                <button class="mod-btn mod-btn-danger" onclick="deleteWifiQR('${row.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLinkTable(data) {
    const tbody = document.getElementById('link-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No Link QR codes generated yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const creatorName = row.profiles?.full_name || row.profiles?.email || 'Unknown User';
        
        tr.innerHTML = `
            <td>${formatDate(row.created_at)}</td>
            <td><span style="color:var(--text-muted); font-size:0.85rem;">${creatorName}</span></td>
            <td><a href="${row.url}" target="_blank" style="color:var(--primary);">${row.url}</a></td>
            <td><span style="text-transform: capitalize;">${row.template_name}</span></td>
            <td>
                <button class="mod-btn mod-btn-danger" onclick="deleteLinkQR('${row.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// === MODERATOR ACTIONS IMPLEMENTATION ===

window.toggleBanUser = async function(userId, currentBannedState) {
    if (currentBannedState) {
        // UNBAN: Restores full login access
        if (!confirm('Are you sure you want to UNBAN this user and restore their login privileges?')) return;

        try {
            const { error } = await supabaseClient
                .from('profiles')
                .update({
                    is_banned: false,
                    ban_reason: null,
                    ban_type: null,
                    banned_until: null
                })
                .eq('id', userId);

            if (error) throw error;

            alert('User successfully unbanned.');
            fetchData();
        } catch (e) {
            console.error("Failed to lift ban details:", e);
            alert(`Error: ${e.message}`);
        }
    } else {
        // BAN: Opens detailed modal
        activeBanUserId = userId;

        // Reset inputs to default values
        document.getElementById('ban-reason-select').value = 'Spam / Excessive QR Generation';
        document.getElementById('custom-reason-container').style.display = 'none';
        document.getElementById('ban-reason-custom').value = '';

        const radios = document.getElementsByName('ban-duration-type');
        radios[0].checked = true; // permanent
        document.getElementById('temporary-duration-container').style.display = 'none';
        
        // Pre-fill datetime-local picker with exactly +1 Hour from current time in local offset format
        const defaultExpiry = new Date();
        defaultExpiry.setHours(defaultExpiry.getHours() + 1);
        const tzOffset = defaultExpiry.getTimezoneOffset() * 60000;
        const localISO = (new Date(defaultExpiry - tzOffset)).toISOString().slice(0, 16);
        document.getElementById('ban-expiry-datetime').value = localISO;

        document.getElementById('ban-modal-overlay').classList.add('show');
    }
};

window.deleteUser = async function(userId) {
    const confirmMessage = `⚠️ CRITICAL ACTION ⚠️\n\n` + 
                           `Are you absolutely sure you want to DELETE this user?\n\n` + 
                           `Deleting their account is permanent and will CASCADE delete all their generated Wi-Fi and Link QR codes!`;

    if (!confirm(confirmMessage)) return;

    try {
        const { error } = await supabaseClient
            .from('profiles')
            .delete()
            .eq('id', userId);

        if (error) throw error;

        alert('User profile and all associated QR codes have been deleted.');
        fetchData();
    } catch (e) {
        console.error("Failed to delete user:", e);
        alert(`Error executing delete action: ${e.message}`);
    }
};

window.deleteWifiQR = async function(qrId) {
    if (!confirm('Are you sure you want to delete this Wi-Fi/Hotspot QR code poster?')) return;

    try {
        const { error } = await supabaseClient
            .from('wifi_qrs')
            .delete()
            .eq('id', qrId);

        if (error) throw error;

        alert('Wi-Fi QR record successfully deleted.');
        fetchData();
    } catch (e) {
        console.error("Failed to delete Wi-Fi QR record:", e);
        alert(`Error executing delete action: ${e.message}`);
    }
};

window.deleteLinkQR = async function(qrId) {
    if (!confirm('Are you sure you want to delete this Link/URL QR code poster?')) return;

    try {
        const { error } = await supabaseClient
            .from('link_qrs')
            .delete()
            .eq('id', qrId);

        if (error) throw error;

        alert('Link QR record successfully deleted.');
        fetchData();
    } catch (e) {
        console.error("Failed to delete Link QR record:", e);
        alert(`Error executing delete action: ${e.message}`);
    }
};

// === PAYMENTS TABLE RENDERER ===
function renderPaymentTable(data) {
    const tbody = document.getElementById('payment-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No payment transactions found. (Run payments table SQL first)</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const userName = row.profiles?.full_name || row.profiles?.email || 'Unknown User';
        const amount = parseFloat(row.amount || 0).toFixed(2);

        // Status badge colour
        const statusColors = {
            success:  { bg: 'rgba(34,197,94,0.15)',  color: '#4ade80',  border: 'rgba(34,197,94,0.3)'  },
            pending:  { bg: 'rgba(251,191,36,0.15)', color: '#fbbf24',  border: 'rgba(251,191,36,0.3)' },
            failed:   { bg: 'rgba(239,68,68,0.15)',  color: '#f87171',  border: 'rgba(239,68,68,0.3)'  },
            refunded: { bg: 'rgba(148,163,184,0.15)',color: '#94a3b8',  border: 'rgba(148,163,184,0.3)'}
        };
        const sc = statusColors[row.status] || statusColors.pending;
        const statusBadge = `<span style="padding:0.25rem 0.65rem; border-radius:2rem; font-size:0.72rem; font-weight:700;
            background:${sc.bg}; color:${sc.color}; border:1px solid ${sc.border}; text-transform:uppercase; letter-spacing:0.5px;">
            ${row.status || 'pending'}</span>`;

        // Refund action only for successful payments
        const refundBtn = row.status === 'success'
            ? `<button class="mod-btn mod-btn-warning" onclick="refundPayment('${row.id}')">Refund</button>`
            : '';

        tr.innerHTML = `
            <td>${formatDate(row.created_at)}</td>
            <td><span style="color:var(--text-muted); font-size:0.85rem;">${userName}</span></td>
            <td><strong>${row.plan_name || '—'}</strong></td>
            <td><span style="color:#fb923c; font-weight:700;">🪙 ${row.tokens_purchased || 0}</span></td>
            <td><span style="color:#4ade80; font-weight:700;">₹${amount}</span></td>
            <td><span style="color:var(--text-muted); font-size:0.82rem;">${row.payment_gateway || 'razorpay'}</span></td>
            <td>${statusBadge}</td>
            <td>${refundBtn || '<span style="color:var(--text-muted); font-size:0.78rem;">—</span>'}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Mark payment as refunded
window.refundPayment = async function(paymentId) {
    if (!confirm('Mark this payment as REFUNDED? This will update the status but will NOT automatically deduct tokens.')) return;
    try {
        const { error } = await supabaseClient
            .from('payments')
            .update({ status: 'refunded', updated_at: new Date().toISOString() })
            .eq('id', paymentId);
        if (error) throw error;
        alert('Payment marked as refunded.');
        fetchData();
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
};

// === TOKEN EDIT MODAL OPENER ===
window.editUserTokens = function(userId, userName, currentBalance) {
    activeTokenUserId = userId;
    activeTokenCurrentBalance = currentBalance;
    document.getElementById('token-modal-username').innerText = userName;
    document.getElementById('token-modal-current').innerText = currentBalance + ' 🪙';
    document.getElementById('token-adjust-amount').value = 50;
    document.getElementById('token-adjust-note').value = '';
    document.getElementById('token-modal-overlay').classList.add('show');
};

// === TOKEN ADJUST HANDLER ===
async function adjustUserTokens() {
    if (!activeTokenUserId) return;

    const adjustBy = parseInt(document.getElementById('token-adjust-amount').value, 10);
    if (isNaN(adjustBy)) {
        alert('Please enter a valid number.');
        return;
    }

    const newBalance = Math.max(0, activeTokenCurrentBalance + adjustBy);
    const confirmBtn = document.getElementById('token-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.innerText = 'Saving...';

    try {
        const result = await setUserTokenBalance(activeTokenUserId, newBalance);
        if (!result.success) throw new Error(result.error || 'Token update failed');

        alert(`✅ Token balance updated!\n${activeTokenCurrentBalance} → ${result.newBalance} tokens`);
        document.getElementById('token-modal-overlay').classList.remove('show');
        activeTokenUserId = null;
        fetchData();
    } catch (e) {
        console.error('Failed to update tokens:', e);
        alert(`Error: ${e.message}`);
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerText = 'Save Changes';
    }
}
