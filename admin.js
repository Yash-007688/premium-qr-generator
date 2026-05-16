// Protect Admin Page (admins only)
window.addEventListener('DOMContentLoaded', async () => {
    const isAdmin = await requireAdmin();
    if (!isAdmin) return;
    fetchData();
});

document.getElementById('refresh-btn').addEventListener('click', fetchData);

async function fetchData() {
    // Show loading states
    document.getElementById('auth-table-body').innerHTML = '<tr><td colspan="5" class="empty-state">Loading...</td></tr>';
    document.getElementById('wifi-table-body').innerHTML = '<tr><td colspan="6" class="empty-state">Loading...</td></tr>';
    document.getElementById('link-table-body').innerHTML = '<tr><td colspan="4" class="empty-state">Loading...</td></tr>';

    try {
        // Fetch Profiles (Auth) Data
        const { data: authData, error: authError } = await supabaseClient
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (authError) console.error(authError);

        // Fetch Wi-Fi Data
        const { data: wifiData, error: wifiError } = await supabaseClient
            .from('wifi_qrs')
            .select('*, profiles(full_name, email)')
            .order('created_at', { ascending: false });

        if (wifiError) console.error(wifiError);

        // Fetch Link Data
        const { data: linkData, error: linkError } = await supabaseClient
            .from('link_qrs')
            .select('*, profiles(full_name, email)')
            .order('created_at', { ascending: false });

        if (linkError) console.error(linkError);

        renderAuthTable(authData);
        renderWifiTable(wifiData);
        renderLinkTable(linkData);

    } catch (e) {
        console.error("Error fetching data:", e);
        const errMsg = '<tr><td colspan="4" class="empty-state" style="color:#ef4444;">Please run the SQL script in Supabase first to create the tables.</td></tr>';
        document.getElementById('auth-table-body').innerHTML = errMsg;
        document.getElementById('wifi-table-body').innerHTML = errMsg;
        document.getElementById('link-table-body').innerHTML = errMsg;
    }
}

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    const d = new Date(isoString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function renderAuthTable(data) {
    const tbody = document.getElementById('auth-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No users registered yet. (Or table missing)</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    data.forEach(row => {
        const tr = document.createElement('tr');
        const role = row.role || 'user';
        const roleLabel = role === 'admin' ? 'Admin' : 'User';
        const roleColor = role === 'admin' ? '#f97316' : 'var(--text-muted)';
        tr.innerHTML = `
            <td>${formatDate(row.created_at)}</td>
            <td><strong>${row.full_name || 'N/A'}</strong></td>
            <td><a href="mailto:${row.email}" style="color:var(--primary); text-decoration:none;">${row.email}</a></td>
            <td><span style="color:${roleColor}; font-weight:600; text-transform:capitalize;">${roleLabel}</span></td>
            <td><span style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${row.id}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderWifiTable(data) {
    const tbody = document.getElementById('wifi-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No Wi-Fi or Hotspot QR codes generated yet. (Or table missing)</td></tr>';
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
                <button class="action-btn" onclick="downloadImage('${row.qr_image_data}', '${row.ssid}_${row.template_name}')">Download Image</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderLinkTable(data) {
    const tbody = document.getElementById('link-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No Link QR codes generated yet. (Or table missing)</td></tr>';
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
                <button class="action-btn" onclick="downloadImage('${row.qr_image_data}', 'Link_${row.template_name}')">Download Image</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Make globally available for inline onclick attributes
window.downloadImage = function(base64Data, filename) {
    const link = document.createElement('a');
    link.download = `${filename}_Admin_DL.png`;
    link.href = base64Data;
    link.click();
};
