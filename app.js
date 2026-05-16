// 0. Protect Dashboard & Handle Logout
window.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('error')) {
        const desc = params.get('error_description') || params.get('error') || 'Sign-in failed';
        alert('Sign-in failed: ' + decodeURIComponent(desc.replace(/\+/g, ' ')));
        window.location.replace('login.html');
        return;
    }

    if (window.location.hash && window.location.hash.includes('access_token')) {
        await supabaseClient.auth.getSession();
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = "login.html";
        return;
    }
    const allowStudio = params.get('studio') === '1';
    if (!allowStudio) {
        const role = await fetchUserRole(session.user.id);
        if (role === 'admin') {
            window.location.replace('admin.html');
        }
    }
});

const logoutBtn = document.querySelector('.logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await supabaseClient.auth.signOut();
        window.location.href = "index.html";
    });
}

// 1. Tab Switching Logic
const tabs = document.querySelectorAll('.tab-btn');
const formSections = document.querySelectorAll('.form-section');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        formSections.forEach(f => f.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab') + '-form';
        document.getElementById(targetId).classList.add('active');
        generatePreview();
    });
});

// Wi-Fi vs Hotspot sub-toggle (within Wi-Fi tab)
let currentWtype = 'wifi';
const wtypeBtns = document.querySelectorAll('.wtype-btn');

function setConnectionType(wtype) {
    currentWtype = wtype;
    wtypeBtns.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-wtype') === wtype);
    });
    const ssidLabel = document.getElementById('ssid-label');
    const ssidInput = document.getElementById('ssid');
    const titleInput = document.getElementById('poster-title');
    if (wtype === 'hotspot') {
        ssidLabel.textContent = 'Hotspot Name (SSID)';
        ssidInput.placeholder = 'e.g. MyPhone Hotspot';
        if (titleInput.value === 'SCAN TO CONNECT' || !titleInput.dataset.userEdited) {
            titleInput.value = 'SCAN TO JOIN HOTSPOT';
        }
    } else {
        ssidLabel.textContent = 'Network Name (SSID)';
        ssidInput.placeholder = 'e.g. MyHomeNetwork';
        if (titleInput.value === 'SCAN TO JOIN HOTSPOT' && !titleInput.dataset.userEdited) {
            titleInput.value = 'SCAN TO CONNECT';
        }
    }
    generatePreview();
}

wtypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        setConnectionType(btn.getAttribute('data-wtype'));
    });
});

document.getElementById('poster-title').addEventListener('input', (e) => {
    e.target.dataset.userEdited = 'true';
    generatePreview();
});

// 2. Template Selection Logic
let currentTemplate = 'minimalist';
const templates = document.querySelectorAll('.template-option');

templates.forEach(template => {
    template.addEventListener('click', () => {
        templates.forEach(t => t.classList.remove('active'));
        template.classList.add('active');
        currentTemplate = template.getAttribute('data-template');
        generatePreview(); // auto-update when template changes
    });
});

// Automatically trigger preview when colors change
document.getElementById('dot-color').addEventListener('input', generatePreview);
document.getElementById('bg-color').addEventListener('input', generatePreview);
// Live update poster text
document.getElementById('poster-subtitle').addEventListener('input', generatePreview);
// Live update Wi-Fi / Hotspot fields
document.getElementById('ssid').addEventListener('input', generatePreview);
document.getElementById('password').addEventListener('input', generatePreview);
document.getElementById('encryption').addEventListener('change', generatePreview);

// 3. QR Code Initialization
const qrCode = new QRCodeStyling({
    width: 400,
    height: 400,
    type: "canvas",
    data: "https://example.com",
    dotsOptions: {
        color: "#000000",
        type: "rounded"
    },
    backgroundOptions: {
        color: "#ffffff",
    },
    cornersSquareOptions: {
        type: "extra-rounded"
    }
});

// 4. Generate Data and Draw
async function generatePreview() {
    const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');
    let qrData = '';

    const escapeStr = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/:/g, '\\:');

    if (activeTab === 'wifi') {
        const ssid = document.getElementById('ssid').value.trim();
        const password = document.getElementById('password').value;
        const encryption = document.getElementById('encryption').value;
        if (!ssid) return;
        qrData = `WIFI:T:${encryption};S:${escapeStr(ssid)};P:${escapeStr(password)};H:false;;`;
    } else {
        qrData = document.getElementById('url').value.trim();
        if (!qrData) return;
    }

    const dotColor = document.getElementById('dot-color').value;
    const bgColor = document.getElementById('bg-color').value;

    // Adjust specific template settings
    let qrType = "rounded";
    if (currentTemplate === 'savage') qrType = "classy";
    if (currentTemplate === 'artdeco') qrType = "dots";

    // Update the QR Library
    qrCode.update({
        data: qrData,
        dotsOptions: {
            color: dotColor,
            type: qrType
        },
        backgroundOptions: {
            color: bgColor
        }
    });

    // Clear raw container and append new canvas
    const rawContainer = document.getElementById('qr-code-raw');
    rawContainer.innerHTML = '';
    qrCode.append(rawContainer);

    // Wait slightly for canvas to be populated by the library
    setTimeout(() => drawPoster(), 50);
}

// 5. Draw the Final Poster on HTML5 Canvas
function drawPoster() {
    const rawCanvas = document.querySelector('#qr-code-raw canvas');
    if (!rawCanvas) return;

    const canvas = document.getElementById('poster-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clear previous drawing
    ctx.clearRect(0, 0, w, h);

    // Draw the selected background template
    if (currentTemplate === 'minimalist') {
        drawMinimalist(ctx, w, h);
    } else if (currentTemplate === 'savage') {
        drawSavage(ctx, w, h);
    } else if (currentTemplate === 'artdeco') {
        drawArtDeco(ctx, w, h);
    }

    // Draw the QR code in the center
    const qrW = 400;
    const qrH = 400;
    const offsetX = (w - qrW) / 2;
    const offsetY = (h - qrH) / 2;

    // Add a slight shadow to the QR code box
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 20;
    ctx.drawImage(rawCanvas, offsetX, offsetY, qrW, qrH);
    ctx.shadowBlur = 0; // Reset shadow

    // Show download button once ready
    document.getElementById('download-btn').style.display = 'block';
}

// === TEMPLATE DRAWING FUNCTIONS ===

function drawMinimalist(ctx, w, h) {
    const titleText = document.getElementById('poster-title').value || 'SCAN TO CONNECT';
    const subtitleText = document.getElementById('poster-subtitle').value || 'Point your camera at the code';

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    
    // Subtle border
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 15;
    ctx.strokeRect(30, 30, w-60, h-60);

    ctx.fillStyle = "#334155";
    ctx.font = "bold 45px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(titleText.toUpperCase(), w/2, 110);
    
    ctx.fillStyle = "#94a3b8";
    ctx.font = "24px Inter, sans-serif";
    ctx.fillText(subtitleText, w/2, h - 80);
}

function drawSavage(ctx, w, h) {
    const titleText = document.getElementById('poster-title').value || 'SAVAGE';
    const subtitleText = document.getElementById('poster-subtitle').value || 'CONNECT';

    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, w, h);

    const neonRed = "#ef4444";
    
    ctx.textAlign = "center";
    ctx.font = "bold 60px Impact, sans-serif";
    
    // Neon glow effect
    ctx.shadowColor = neonRed;
    ctx.shadowBlur = 25;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(titleText.toUpperCase(), w/2, 130);
    ctx.fillText(subtitleText.toUpperCase(), w/2, h - 90);
    
    ctx.shadowBlur = 0;

    // Corner brackets
    ctx.strokeStyle = neonRed;
    ctx.lineWidth = 10;
    const pad = 120;
    const len = 90;
    
    ctx.beginPath();
    ctx.moveTo(pad + len, pad); ctx.lineTo(pad, pad); ctx.lineTo(pad, pad + len);
    ctx.moveTo(w - pad - len, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + len);
    ctx.moveTo(pad, h - pad - len); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + len, h - pad);
    ctx.moveTo(w - pad, h - pad - len); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad - len, h - pad);
    ctx.stroke();
}

function drawArtDeco(ctx, w, h) {
    const titleText = document.getElementById('poster-title').value || 'SCAN TO CONNECT';
    const subtitleText = document.getElementById('poster-subtitle').value || 'SCAN TO CONNECT';

    const gold = "#efc67c";
    const bg = "#121821";
    
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    for(let i=0; i<=w; i+=60) {
        ctx.beginPath();
        ctx.moveTo(i, 0); ctx.lineTo(i, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i); ctx.lineTo(w, i);
        ctx.stroke();
    }

    ctx.fillStyle = gold;
    ctx.font = "38px 'Segoe UI Light', 'Helvetica Neue', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(titleText.toUpperCase(), w/2, 120);
    ctx.fillText(subtitleText.toUpperCase(), w/2, h - 90);

    ctx.strokeStyle = gold;
    ctx.lineWidth = 8;
    const pad = 140;
    const len = 80;
    
    ctx.beginPath();
    ctx.moveTo(pad + len, pad); ctx.lineTo(pad, pad); ctx.lineTo(pad, pad + len);
    ctx.moveTo(w - pad - len, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + len);
    ctx.moveTo(pad, h - pad - len); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + len, h - pad);
    ctx.moveTo(w - pad, h - pad - len); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad - len, h - pad);
    ctx.stroke();
}

// Generate Button Event
document.getElementById('generate-btn').addEventListener('click', generatePreview);

// Download Button Event
document.getElementById('download-btn').addEventListener('click', async () => {
    const canvas = document.getElementById('poster-canvas');
    const imageData = canvas.toDataURL('image/png');
    
    const activeTab = document.querySelector('.tab-btn.active').getAttribute('data-tab');
    let name = 'Link';
    const connectionType = activeTab === 'wifi' ? currentWtype : null;
    if (activeTab === 'wifi') name = document.getElementById('ssid').value;
    
    const btn = document.getElementById('download-btn');
    const originalText = btn.innerText;
    btn.innerText = "Saving & Downloading...";
    btn.disabled = true;
    
    // Save to Supabase Database
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const session = sessionData?.session;
        const userId = session?.user?.id;
        
        if (userId) {
            // Step 1: Upsert profile so FK never fails
            await supabaseClient.from('profiles').upsert({
                id: userId,
                email: session.user.email,
                full_name: session.user.user_metadata?.full_name || ''
            }, { onConflict: 'id', ignoreDuplicates: true });

            // Step 2: Insert new QR record (each download = new row)
            let dbError = null;
            if (activeTab === 'wifi') {
                const { error } = await supabaseClient.from('wifi_qrs').insert({
                    user_id: userId,
                    ssid: name,
                    connection_type: connectionType,
                    template_name: currentTemplate,
                    qr_image_data: imageData
                });
                dbError = error;
            } else {
                const { error } = await supabaseClient.from('link_qrs').insert({
                    user_id: userId,
                    url: document.getElementById('url').value,
                    template_name: currentTemplate,
                    qr_image_data: imageData
                });
                dbError = error;
            }

            if (dbError) {
                console.error("DB Insert Error:", dbError.message);
            }
        }
    } catch (e) {
        console.error("Error saving to database:", e);
    }
    
    // Always download the file
    const link = document.createElement('a');
    const typeSuffix = connectionType === 'hotspot' ? 'Hotspot' : connectionType === 'wifi' ? 'WiFi' : '';
    link.download = typeSuffix
        ? `${name}_${currentTemplate}_${typeSuffix}_QR.png`
        : `${name}_${currentTemplate}_QR.png`;
    link.href = imageData;
    link.click();
    
    btn.innerText = originalText;
    btn.disabled = false;
});

// Initial generation
window.onload = generatePreview;
