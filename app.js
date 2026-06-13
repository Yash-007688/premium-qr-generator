// 0. Protect Dashboard & Handle Logout
let userTier = 'free';
let uploadedLogoDataUrl = null;

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
    await ensureUserProfile(session);

    // Fetch user profile status and tier
    const { data: profile, error } = await supabaseClient
        .from('profiles')
        .select('role, is_banned, tier')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profile?.is_banned) {
        await supabaseClient.auth.signOut();
        window.location.replace('banned.html');
        return;
    }

    userTier = profile?.tier || 'free';
    const role = profile?.role || 'user';

    // Inject the Unified Glassmorphic Profile Dropdown
    await injectUnifiedDropdown('.dashboard-nav');

    const allowStudio = params.get('studio') === '1';
    if (!allowStudio) {
        if (role === 'admin') {
            window.location.replace('admin.html');
        }
    }

    // Configure initial UI based on user's membership tier
    updateUIForTier();
    setupLocksAndInterceptors();
    setupUpgradeModal();
    setupLogoUpload();

    // Generate initial preview once user is loaded
    generatePreview();
});

// Reactively handle tier changes from the navigation bar
window.addEventListener('tierchange', (e) => {
    userTier = e.detail.tier;
    updateUIForTier();
    generatePreview();
});

function updateUIForTier() {
    const lockOverlaySavage = document.querySelector('[data-template="savage"] .lock-overlay');
    const lockOverlayArtDeco = document.querySelector('[data-template="artdeco"] .lock-overlay');
    const analyticsOverlay = document.getElementById('analytics-lock-overlay');
    const advancedCustomSection = document.querySelector('.advanced-customization');
    const gradientContainer = document.getElementById('gradient-color-picker-group');
    const enableGradientCheckbox = document.getElementById('enable-gradient');
    const logoInput = document.getElementById('logo-upload');
    const dotShapeSelect = document.getElementById('dot-shape');
    const eyeShapeSelect = document.getElementById('eye-shape');

    if (userTier === 'free') {
        // Show lock icons
        if (lockOverlaySavage) lockOverlaySavage.style.display = 'flex';
        if (lockOverlayArtDeco) lockOverlayArtDeco.style.display = 'flex';
        
        // Show analytics lock overlay
        if (analyticsOverlay) analyticsOverlay.style.display = 'flex';

        // Add visual lockers to inputs
        document.querySelectorAll('.premium-lock-trigger').forEach(el => {
            el.classList.add('premium-locked-item');
        });

        // Revert premium templates to minimalist
        if (currentTemplate === 'savage' || currentTemplate === 'artdeco') {
            currentTemplate = 'minimalist';
            document.querySelectorAll('.template-option').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-template="minimalist"]').classList.add('active');
        }

        // Disable and uncheck premium fields
        if (enableGradientCheckbox) {
            enableGradientCheckbox.checked = false;
            enableGradientCheckbox.disabled = true;
        }
        if (gradientContainer) gradientContainer.style.display = 'none';

        if (logoInput) logoInput.disabled = true;
        if (dotShapeSelect) {
            dotShapeSelect.value = 'rounded';
            dotShapeSelect.disabled = true;
        }
        if (eyeShapeSelect) {
            eyeShapeSelect.value = 'extra-rounded';
            eyeShapeSelect.disabled = true;
        }

        // Revert Dynamic URL to static
        const staticRadio = document.querySelector('input[name="qr-type-toggle"][value="static"]');
        if (staticRadio) staticRadio.checked = true;
        const dynamicRadio = document.getElementById('dynamic-toggle-radio');
        if (dynamicRadio) dynamicRadio.disabled = true;

    } else {
        // Unlock EVERYTHING
        if (lockOverlaySavage) lockOverlaySavage.style.display = 'none';
        if (lockOverlayArtDeco) lockOverlayArtDeco.style.display = 'none';
        if (analyticsOverlay) analyticsOverlay.style.display = 'none';

        document.querySelectorAll('.premium-lock-trigger').forEach(el => {
            el.classList.remove('premium-locked-item');
        });

        if (enableGradientCheckbox) enableGradientCheckbox.disabled = false;
        if (logoInput) logoInput.disabled = false;
        if (dotShapeSelect) dotShapeSelect.disabled = false;
        if (eyeShapeSelect) eyeShapeSelect.disabled = false;
        
        const dynamicRadio = document.getElementById('dynamic-toggle-radio');
        if (dynamicRadio) dynamicRadio.disabled = false;
    }
}

function setupLocksAndInterceptors() {
    // Intercept template clicks
    document.querySelectorAll('.template-option').forEach(option => {
        option.addEventListener('click', (e) => {
            if (userTier === 'free' && option.classList.contains('premium-lock-trigger')) {
                e.stopPropagation();
                e.preventDefault();
                showUpgradeModal(option.getAttribute('data-feature'));
            }
        });
    });

    // Intercept premium option clicks
    document.querySelectorAll('.premium-lock-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            if (userTier === 'free') {
                e.stopPropagation();
                e.preventDefault();
                showUpgradeModal(el.getAttribute('data-feature'));
            }
        });
    });
}

function setupUpgradeModal() {
    const modal = document.getElementById('upgrade-modal');
    const closeBtn = document.getElementById('close-modal-btn');
    const proSelect = document.getElementById('pro-tier-select');
    const entSelect = document.getElementById('ent-tier-select');
    const submitBtn = document.getElementById('submit-upgrade-sim-btn');
    
    // Tabs & sections
    const tabSubs = document.getElementById('tab-upgrade-subs');
    const tabTokens = document.getElementById('tab-buy-tokens');
    const subsSection = document.getElementById('subs-pricing-section');
    const tokensSection = document.getElementById('token-packs-section');
    
    // Token packs
    const packStarter = document.getElementById('pack-starter-select');
    const packBooster = document.getElementById('pack-booster-select');
    
    let selectedTier = 'pro';
    let selectedPack = 'starter';
    let currentModalMode = 'subs'; // 'subs' or 'tokens'

    closeBtn.addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('show');
    });

    // Subscriptions tabs behavior
    proSelect.addEventListener('click', () => {
        proSelect.classList.add('active');
        entSelect.classList.remove('active');
        selectedTier = 'pro';
    });

    entSelect.addEventListener('click', () => {
        entSelect.classList.add('active');
        proSelect.classList.remove('active');
        selectedTier = 'enterprise';
    });

    // Token packs behavior
    packStarter.addEventListener('click', () => {
        packStarter.classList.add('active');
        packBooster.classList.remove('active');
        selectedPack = 'starter';
    });

    packBooster.addEventListener('click', () => {
        packBooster.classList.add('active');
        packStarter.classList.remove('active');
        selectedPack = 'booster';
    });

    // Tab Switching behaviors
    tabSubs.addEventListener('click', () => {
        tabSubs.classList.add('active');
        tabSubs.style.color = 'var(--text-main)';
        tabSubs.style.borderBottom = '2px solid var(--primary)';
        tabTokens.classList.remove('active');
        tabTokens.style.color = 'var(--text-muted)';
        tabTokens.style.borderBottom = 'none';

        subsSection.style.display = 'grid';
        tokensSection.style.display = 'none';
        currentModalMode = 'subs';
    });

    tabTokens.addEventListener('click', () => {
        tabTokens.classList.add('active');
        tabTokens.style.color = 'var(--text-main)';
        tabTokens.style.borderBottom = '2px solid var(--primary)';
        tabSubs.classList.remove('active');
        tabSubs.style.color = 'var(--text-muted)';
        tabSubs.style.borderBottom = 'none';

        subsSection.style.display = 'none';
        tokensSection.style.display = 'grid';
        currentModalMode = 'tokens';
    });

    submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        submitBtn.innerText = "Connecting to Payment Gateway...";

        // Set amount based on current choice
        let amount = 0;
        let description = "";
        
        if (currentModalMode === 'subs') {
            amount = selectedTier === 'pro' ? 799 : 3999; // Amount in INR
            description = `Upgrade to ${selectedTier === 'pro' ? 'Pro Plan ✨' : 'Enterprise Plan 🏆'}`;
        } else {
            amount = selectedPack === 'starter' ? 49 : 149; // Amount in INR
            description = `Purchase ${selectedPack === 'starter' ? '20' : '100'} Tokens Pack`;
        }

        const options = {
            key: "rzp_test_yourkeyhere", // Replace with your live / test key from Razorpay Dashboard
            amount: amount * 100, // Amount in paise
            currency: "INR",
            name: "QR Web Generator",
            description: description,
            image: "logo.png",
            handler: async function (response) {
                alert(`✅ Payment Successful!\nPayment ID: ${response.razorpay_payment_id}\nProvisioning your account...`);
                try {
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session) {
                        if (currentModalMode === 'subs') {
                            const { error } = await supabaseClient
                                .from('profiles')
                                .update({ tier: selectedTier })
                                .eq('id', session.user.id);
                            if (error) throw error;
                            
                            userTier = selectedTier;
                            updateUIForTier();
                            generatePreview();
                            alert(`Congratulations! You have successfully upgraded to ${selectedTier === 'pro' ? 'Pro Plan ✨' : 'Enterprise Plan 🏆'}!`);
                        } else {
                            // Credit tokens
                            const tokensToAdd = selectedPack === 'starter' ? 20 : 100;
                            const { data: profile } = await supabaseClient
                                .from('profiles')
                                .select('tokens')
                                .eq('id', session.user.id)
                                .maybeSingle();
                            
                            const newBalance = (profile?.tokens ?? 0) + tokensToAdd;
                            const { error } = await supabaseClient
                                .from('profiles')
                                .update({ tokens: newBalance })
                                .eq('id', session.user.id);
                            if (error) throw error;

                            alert(`Successfully added ${tokensToAdd} tokens!`);
                        }
                        await injectUnifiedDropdown('.dashboard-nav');
                    }
                } catch (err) {
                    console.error("Database update error:", err);
                    alert("Error updating database record: " + err.message);
                } finally {
                    modal.classList.remove('show');
                }
            },
            theme: {
                color: "#6366f1"
            }
        };

        try {
            const rzp = new Razorpay(options);
            rzp.open();
        } catch (e) {
            console.error("Razorpay loading error:", e);
            alert("Razorpay checkout failed to load. Please verify script availability.");
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerText = "Proceed to Payment";
        }
    });

    // Handle analytics upgrade trigger click
    document.getElementById('analytics-upgrade-trigger').addEventListener('click', () => {
        // Switch to subscription tab when triggered from analytics dashboard lock
        tabSubs.click();
        showUpgradeModal('Analytics Dashboard');
    });
}

function showUpgradeModal(featureName = '') {
    const modal = document.getElementById('upgrade-modal');
    if (featureName) {
        modal.querySelector('.modal-header-premium p').innerText = `Unlock ${featureName} and more with premium options`;
    } else {
        modal.querySelector('.modal-header-premium p').innerText = `Unlock the full potential of your Creator Studio`;
    }
    modal.classList.add('show');
}

function setupLogoUpload() {
    const logoInput = document.getElementById('logo-upload');
    const removeBtn = document.getElementById('remove-logo-btn');

    logoInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            uploadedLogoDataUrl = event.target.result;
            removeBtn.style.display = 'block';
            generatePreview();
        };
        reader.readAsDataURL(file);
    });

    removeBtn.addEventListener('click', () => {
        uploadedLogoDataUrl = null;
        logoInput.value = '';
        removeBtn.style.display = 'none';
        generatePreview();
    });
}

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
        const activeTab = tab.getAttribute('data-tab');

        if (activeTab === 'analytics') {
            document.getElementById('preview-stage').style.display = 'none';
            document.getElementById('analytics-stage').style.display = 'block';
            // Hide control forms
            formSections.forEach(f => f.classList.remove('active'));
        } else {
            document.getElementById('preview-stage').style.display = 'flex';
            document.getElementById('analytics-stage').style.display = 'none';
            const targetId = activeTab + '-form';
            document.getElementById(targetId).classList.add('active');
            generatePreview();
        }
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
        if (userTier === 'free' && template.classList.contains('premium-lock-trigger')) {
            return; // Intercepted
        }
        templates.forEach(t => t.classList.remove('active'));
        template.classList.add('active');
        currentTemplate = template.getAttribute('data-template');
        generatePreview(); // auto-update when template changes
    });
});

// Automatically trigger preview when colors change
document.getElementById('dot-color').addEventListener('input', generatePreview);
document.getElementById('bg-color').addEventListener('input', generatePreview);
document.getElementById('dot-color-2').addEventListener('input', generatePreview);

// Live update poster text
document.getElementById('poster-subtitle').addEventListener('input', generatePreview);
// Live update Wi-Fi / Hotspot fields
document.getElementById('ssid').addEventListener('input', generatePreview);
document.getElementById('password').addEventListener('input', generatePreview);
document.getElementById('encryption').addEventListener('change', generatePreview);

// Advanced custom styling inputs
document.getElementById('dot-shape').addEventListener('change', generatePreview);
document.getElementById('eye-shape').addEventListener('change', generatePreview);
document.getElementById('enable-gradient').addEventListener('change', function() {
    const endColorGroup = document.getElementById('gradient-color-picker-group');
    if (this.checked) {
        endColorGroup.style.display = 'block';
    } else {
        endColorGroup.style.display = 'none';
    }
    generatePreview();
});

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
    if (activeTab === 'analytics') return;
    
    let qrData = '';

    const escapeStr = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/:/g, '\\:');

    if (activeTab === 'wifi') {
        const ssid = document.getElementById('ssid').value.trim();
        const password = document.getElementById('password').value;
        const encryption = document.getElementById('encryption').value;
        if (!ssid) return;
        qrData = `WIFI:T:${encryption};S:${escapeStr(ssid)};P:${escapeStr(password)};H:false;;`;
    } else {
        const urlInput = document.getElementById('url').value.trim();
        if (!urlInput) return;

        const isDynamic = document.querySelector('input[name="qr-type-toggle"]:checked')?.value === 'dynamic';
        if (isDynamic && userTier !== 'free') {
            // Simulated Short/Dynamic URL redirect
            const randomHash = Math.random().toString(36).substring(2, 8);
            qrData = `https://qrweb.app/${randomHash}`;
        } else {
            qrData = urlInput;
        }
    }

    const dotColor = document.getElementById('dot-color').value;
    const bgColor = document.getElementById('bg-color').value;
    const dotColor2 = document.getElementById('dot-color-2').value;
    const useGradient = document.getElementById('enable-gradient').checked && userTier !== 'free';

    // Advanced customizations (Pro features)
    let dotType = document.getElementById('dot-shape').value;
    let eyeType = document.getElementById('eye-shape').value;

    if (userTier === 'free') {
        // Reset/ignore premium modifications
        dotType = "rounded";
        if (currentTemplate === 'savage') dotType = "classy";
        if (currentTemplate === 'artdeco') dotType = "dots";
        eyeType = "extra-rounded";
    }

    // Config gradient options if enabled
    let dotsOptions = {
        color: dotColor,
        type: dotType
    };

    if (useGradient) {
        dotsOptions.gradient = {
            type: "linear",
            rotation: 45,
            colorStops: [
                { offset: 0, color: dotColor },
                { offset: 1, color: dotColor2 }
            ]
        };
    }

    // Update the QR Library
    qrCode.update({
        data: qrData,
        dotsOptions: dotsOptions,
        backgroundOptions: {
            color: bgColor
        },
        cornersSquareOptions: {
            type: eyeType
        },
        image: (uploadedLogoDataUrl && userTier !== 'free') ? uploadedLogoDataUrl : "",
        imageOptions: {
            crossOrigin: "anonymous",
            margin: 6,
            imageSize: 0.45
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

    // Inject Watermark for Free Tier Users
    if (userTier === 'free') {
        ctx.fillStyle = currentTemplate === 'minimalist' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
        ctx.font = "bold 18px 'Inter', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("✨ Created with QR Web", w / 2, h - 35);
    }

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
    // 1. Fetch current profile limits
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            // Query current count of saved posters
            const { count: wifiCount } = await supabaseClient
                .from('wifi_qrs')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', session.user.id);
            const { count: linkCount } = await supabaseClient
                .from('link_qrs')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', session.user.id);

            const totalSaved = (wifiCount || 0) + (linkCount || 0);

            // Limit Enforcement: Free users are maxed at 3 saves/downloads
            if (userTier === 'free' && totalSaved >= 3) {
                alert("You have reached the limit of 3 saved QR codes for the Free tier. Please upgrade to Pro for increased limits!");
                showUpgradeModal('Saved QR Codes Limits');
                return;
            }
        }
    } catch (err) {
        console.error("Error enforcing limits:", err);
    }

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
            await ensureUserProfile(session);

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
