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
    setupCanvasLayersSystem();

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
    const gradientContainer = document.getElementById('gradient-color-picker-group');
    const enableGradientCheckbox = document.getElementById('enable-gradient');
    const logoInput = document.getElementById('logo-upload');
    const dotShapeSelect = document.getElementById('dot-shape');
    const eyeShapeSelect = document.getElementById('eye-shape');

    // Reset lock trigger styling classes
    document.querySelectorAll('.premium-lock-trigger').forEach(el => {
        el.classList.remove('premium-locked-item');
    });

    if (userTier === 'free') {
        // Show lock icons for templates
        if (lockOverlaySavage) lockOverlaySavage.style.display = 'flex';
        if (lockOverlayArtDeco) lockOverlayArtDeco.style.display = 'flex';
        
        // Show analytics lock overlay
        if (analyticsOverlay) analyticsOverlay.style.display = 'flex';

        // Add visual lockers to all premium inputs
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

        // Clear custom layers and backgrounds
        canvasLayers = [];
        uploadedBgImageDataUrl = null;
        qrPosition = { x: 200, y: 200, size: 400 };
        renderLayersUI();

    } else if (userTier === 'pro') {
        // PRO: Unlock basic features but lock Enterprise exclusive features
        if (lockOverlaySavage) lockOverlaySavage.style.display = 'none';
        if (lockOverlayArtDeco) lockOverlayArtDeco.style.display = 'none';
        if (analyticsOverlay) analyticsOverlay.style.display = 'none';

        // Mark only enterprise features as locked
        document.querySelectorAll('.premium-lock-trigger').forEach(el => {
            const feat = el.getAttribute('data-feature') || '';
            if (feat.toLowerCase().includes('enterprise')) {
                el.classList.add('premium-locked-item');
            }
        });

        if (enableGradientCheckbox) enableGradientCheckbox.disabled = false;
        if (logoInput) logoInput.disabled = false;
        if (dotShapeSelect) dotShapeSelect.disabled = false;
        if (eyeShapeSelect) eyeShapeSelect.disabled = false;
        
        const dynamicRadio = document.getElementById('dynamic-toggle-radio');
        if (dynamicRadio) dynamicRadio.disabled = false;

        // Clear custom layers and backgrounds if downgraded to Pro
        canvasLayers = [];
        uploadedBgImageDataUrl = null;
        qrPosition = { x: 200, y: 200, size: 400 };
        renderLayersUI();

    } else if (userTier === 'enterprise') {
        // ENTERPRISE: Unlock EVERYTHING
        if (lockOverlaySavage) lockOverlaySavage.style.display = 'none';
        if (lockOverlayArtDeco) lockOverlayArtDeco.style.display = 'none';
        if (analyticsOverlay) analyticsOverlay.style.display = 'none';

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
            const feature = el.getAttribute('data-feature') || '';
            const isEnterpriseOnly = feature.toLowerCase().includes('enterprise');

            if (userTier === 'free') {
                e.stopPropagation();
                e.preventDefault();
                showUpgradeModal(feature);
            } else if (userTier === 'pro' && isEnterpriseOnly) {
                e.stopPropagation();
                e.preventDefault();
                showUpgradeModal(feature);
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

        let amount = 0;
        let description = "";
        let planName = "";

        if (currentModalMode === 'subs') {
            amount = selectedTier === 'pro' ? 799 : 3999;
            description = `Upgrade to ${selectedTier === 'pro' ? 'Pro Plan' : 'Enterprise Plan'}`;
            planName = selectedTier === 'pro' ? 'Pro Subscription' : 'Enterprise Subscription';
        } else {
            amount = selectedPack === 'starter' ? 49 : 149;
            const tokenCount = selectedPack === 'starter' ? 20 : 100;
            description = `Purchase ${tokenCount} Tokens Pack`;
            planName = selectedPack === 'starter' ? 'Starter Token Pack (20)' : 'Booster Token Pack (100)';
        }

        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            alert('Please log in again to continue.');
            submitBtn.disabled = false;
            submitBtn.innerText = "Proceed to Payment";
            return;
        }

        const userName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
        const userEmail = session.user.email || '';

        const opened = openRazorpayCheckout({
            amountInr: amount,
            description,
            userName,
            userEmail,
            onDismiss: () => {
                submitBtn.disabled = false;
                submitBtn.innerText = "Proceed to Payment";
            },
            onSuccess: async function (response) {
                try {
                    if (currentModalMode === 'subs') {
                        const result = await processSubscriptionPurchase(
                            session.user.id,
                            selectedTier,
                            amount,
                            planName,
                            response
                        );
                        if (!result.success) throw new Error(result.error);

                        userTier = selectedTier;
                        updateUIForTier();
                        generatePreview();
                        alert(`Upgraded to ${selectedTier === 'pro' ? 'Pro Plan' : 'Enterprise Plan'} successfully! You now have ${result.tokens} tokens.`);
                    } else {
                        const tokensToAdd = selectedPack === 'starter' ? 20 : 100;
                        const result = await processTokenPackPurchase(
                            session.user.id,
                            tokensToAdd,
                            amount,
                            planName,
                            response
                        );
                        if (!result.success) throw new Error(result.error);

                        alert(`Successfully added ${tokensToAdd} tokens! New balance: ${result.newBalance}`);
                    }
                    await injectUnifiedDropdown('.dashboard-nav');
                    modal.classList.remove('show');
                } catch (err) {
                    console.error("Payment processing error:", err);
                    alert("Payment received but account update failed: " + err.message);
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.innerText = "Proceed to Payment";
                }
            }
        });

        if (!opened) {
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

// ============================================================
//  YOUTUBE TIMESTAMP SYSTEM
// ============================================================

const ytTimestampState = {
    videoId: null,
    baseUrl: null,
    timestamps: [],        // [{ id, seconds, label }]
    activeTimestampId: null
};

/** Extract YouTube video ID from any YouTube URL format */
function extractYouTubeVideoId(url) {
    try {
        const u = new URL(url);
        const host = u.hostname.replace('www.', '');
        if (host === 'youtube.com' || host === 'm.youtube.com') {
            if (u.pathname === '/watch') return u.searchParams.get('v');
            const shortMatch = u.pathname.match(/^\/(?:embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
            if (shortMatch) return shortMatch[1];
        }
        if (host === 'youtu.be') {
            return u.pathname.slice(1).split('?')[0];
        }
    } catch (_) {}
    return null;
}

/** Check if a string looks like a YouTube URL */
function isYouTubeUrl(url) {
    return /(?:youtube\.com|youtu\.be)/i.test(url);
}

/** Format total seconds → H:MM:SS or M:SS */
function formatSeconds(secs) {
    const s = Math.max(0, Math.floor(secs));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Build a YouTube URL with the given start time in seconds */
function buildYouTubeTimestampUrl(videoId, seconds) {
    const t = Math.max(0, Math.floor(seconds));
    return `https://www.youtube.com/watch?v=${videoId}&t=${t}s`;
}

/** Show / update the YouTube panel */
function showYouTubePanel(videoId, rawUrl) {
    ytTimestampState.videoId = videoId;
    ytTimestampState.baseUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const panel = document.getElementById('yt-timestamp-panel');
    panel.style.display = 'block';
    // Re-trigger animation
    panel.style.animation = 'none';
    panel.offsetHeight; // reflow
    panel.style.animation = '';

    // Thumbnail
    const thumb = document.getElementById('yt-thumbnail');
    thumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    thumb.onerror = () => { thumb.src = ''; };

    // Meta text
    document.getElementById('yt-video-id-display').textContent = videoId;
    document.getElementById('yt-url-clean').textContent = `youtube.com/watch?v=${videoId}`;

    renderTimestampList();
    updateActiveInfo();
}

/** Hide the YouTube panel and reset state */
function hideYouTubePanel() {
    document.getElementById('yt-timestamp-panel').style.display = 'none';
    ytTimestampState.videoId = null;
    ytTimestampState.baseUrl = null;
    ytTimestampState.activeTimestampId = null;
    // Do NOT clear timestamps — keep them for convenience
    updateActiveInfo();
}

/** Render all timestamp list items */
function renderTimestampList() {
    const list = document.getElementById('yt-ts-list');
    const wrapper = document.getElementById('yt-ts-list-wrapper');
    const tss = ytTimestampState.timestamps;

    if (tss.length === 0) {
        wrapper.style.display = 'none';
        return;
    }
    wrapper.style.display = 'block';

    list.innerHTML = '';
    tss.forEach(ts => {
        const li = document.createElement('li');
        li.className = 'yt-ts-item' + (ts.id === ytTimestampState.activeTimestampId ? ' active-ts' : '');
        li.dataset.id = ts.id;

        li.innerHTML = `
            <span class="ts-item-time">${formatSeconds(ts.seconds)}</span>
            <span class="ts-item-label ${ts.label ? '' : 'no-label'}">${ts.label || 'No label'}</span>
            <span class="ts-item-select-badge">Active</span>
            <button class="ts-item-delete" title="Remove" data-id="${ts.id}">✕</button>
        `;

        // Click row → set as active QR target
        li.addEventListener('click', (e) => {
            if (e.target.classList.contains('ts-item-delete')) return;
            setActiveTimestamp(ts.id);
        });

        // Delete button
        li.querySelector('.ts-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTimestamp(ts.id);
        });

        list.appendChild(li);
    });
}

/** Set a timestamp as the active QR target */
function setActiveTimestamp(id) {
    ytTimestampState.activeTimestampId = id;
    renderTimestampList();
    updateActiveInfo();
    generatePreview();
}

/** Remove a timestamp entry */
function deleteTimestamp(id) {
    ytTimestampState.timestamps = ytTimestampState.timestamps.filter(t => t.id !== id);
    if (ytTimestampState.activeTimestampId === id) {
        ytTimestampState.activeTimestampId = null;
    }
    renderTimestampList();
    updateActiveInfo();
    generatePreview();
}

/** Update the active-QR info bar at the bottom of the panel */
function updateActiveInfo() {
    const infoBar = document.getElementById('yt-ts-active-info');
    const activeTs = ytTimestampState.timestamps.find(t => t.id === ytTimestampState.activeTimestampId);

    if (activeTs) {
        infoBar.style.display = 'flex';
        document.getElementById('yt-ts-active-time').textContent = formatSeconds(activeTs.seconds);
        const nameEl = document.getElementById('yt-ts-active-name');
        nameEl.textContent = activeTs.label ? `"${activeTs.label}"` : '';
    } else {
        infoBar.style.display = 'none';
    }
}

/** Add a new timestamp from the input fields */
function addTimestampFromInputs() {
    const h = parseInt(document.getElementById('ts-hours').value) || 0;
    const m = parseInt(document.getElementById('ts-minutes').value) || 0;
    const s = parseInt(document.getElementById('ts-seconds').value) || 0;
    const label = document.getElementById('ts-label').value.trim();

    const totalSeconds = h * 3600 + m * 60 + s;

    const newTs = {
        id: Date.now().toString(),
        seconds: totalSeconds,
        label: label
    };

    ytTimestampState.timestamps.push(newTs);
    // Sort by time ascending
    ytTimestampState.timestamps.sort((a, b) => a.seconds - b.seconds);

    // Auto-select if first timestamp
    if (ytTimestampState.timestamps.length === 1) {
        ytTimestampState.activeTimestampId = newTs.id;
    }

    // Reset inputs
    document.getElementById('ts-hours').value = 0;
    document.getElementById('ts-minutes').value = 0;
    document.getElementById('ts-seconds').value = 0;
    document.getElementById('ts-label').value = '';

    renderTimestampList();
    updateActiveInfo();
    generatePreview();

    // Flash the add button
    const btn = document.getElementById('ts-add-btn');
    btn.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)';
    setTimeout(() => { btn.style.background = ''; }, 600);
}

// Wire up timestamp UI events (deferred until DOM ready)
document.addEventListener('DOMContentLoaded', () => {
    // Add button
    document.getElementById('ts-add-btn').addEventListener('click', addTimestampFromInputs);

    // Enter key on label input
    document.getElementById('ts-label').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTimestampFromInputs();
    });

    // Enter key on time inputs
    ['ts-hours', 'ts-minutes', 'ts-seconds'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addTimestampFromInputs();
        });
    });

    // Clear all
    document.getElementById('ts-clear-all-btn').addEventListener('click', () => {
        ytTimestampState.timestamps = [];
        ytTimestampState.activeTimestampId = null;
        renderTimestampList();
        updateActiveInfo();
        generatePreview();
    });

    // Reset to start (deselect active timestamp)
    document.getElementById('yt-ts-reset-btn').addEventListener('click', () => {
        ytTimestampState.activeTimestampId = null;
        renderTimestampList();
        updateActiveInfo();
        generatePreview();
    });
});

// Watch the URL input for YouTube links
document.getElementById('url').addEventListener('input', function () {
    const val = this.value.trim();
    if (isYouTubeUrl(val)) {
        const vid = extractYouTubeVideoId(val);
        if (vid && vid !== ytTimestampState.videoId) {
            // New YouTube video detected
            ytTimestampState.timestamps = [];
            ytTimestampState.activeTimestampId = null;
            showYouTubePanel(vid, val);
        } else if (vid) {
            showYouTubePanel(vid, val);
        } else {
            hideYouTubePanel();
        }
    } else {
        if (ytTimestampState.videoId) hideYouTubePanel();
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
            // Check for an active YouTube timestamp
            const activeTs = ytTimestampState.timestamps.find(t => t.id === ytTimestampState.activeTimestampId);
            if (ytTimestampState.videoId && activeTs) {
                qrData = buildYouTubeTimestampUrl(ytTimestampState.videoId, activeTs.seconds);
            } else {
                qrData = urlInput;
            }
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
        image: (uploadedLogoDataUrl && userTier !== 'free')
            ? uploadedLogoDataUrl
            : (activeTab === 'url' && isYouTubeUrl(document.getElementById('url').value.trim()))
                ? `data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`
                : "",
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
// Image cache helper
const imageCache = {};
function getCachedImage(src, callback) {
    if (imageCache[src]) {
        if (imageCache[src].complete) {
            callback(imageCache[src]);
        } else {
            imageCache[src].onload = () => callback(imageCache[src]);
        }
        return;
    }
    const img = new Image();
    img.src = src;
    imageCache[src] = img;
    img.onload = () => {
        callback(img);
    };
}

let uploadedBgImageDataUrl = null;
let canvasLayers = [];
let qrPosition = { x: 200, y: 200, size: 400 };
let activeDragElement = null; // { type: 'qr' | 'layer', id: string, offsetX: number, offsetY: number }

function drawPoster() {
    const rawCanvas = document.querySelector('#qr-code-raw canvas');
    if (!rawCanvas) return;

    const canvas = document.getElementById('poster-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Clear previous drawing
    ctx.clearRect(0, 0, w, h);

    // Draw background (either uploaded custom bg or template)
    if (uploadedBgImageDataUrl && userTier !== 'free') {
        const bgImg = imageCache[uploadedBgImageDataUrl];
        if (bgImg) {
            ctx.drawImage(bgImg, 0, 0, w, h);
        } else {
            getCachedImage(uploadedBgImageDataUrl, () => drawPoster());
            // Draw placeholder background color while loading
            ctx.fillStyle = "#121821";
            ctx.fillRect(0, 0, w, h);
        }
    } else {
        // Draw the selected background template
        if (currentTemplate === 'minimalist') {
            drawMinimalist(ctx, w, h);
        } else if (currentTemplate === 'savage') {
            drawSavage(ctx, w, h);
        } else if (currentTemplate === 'artdeco') {
            drawArtDeco(ctx, w, h);
        }
    }

    // Draw the QR code (draggable)
    const qrX = qrPosition.x;
    const qrY = qrPosition.y;
    const qrS = qrPosition.size;

    // Add a slight shadow to the QR code box
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 20;
    ctx.drawImage(rawCanvas, qrX, qrY, qrS, qrS);
    ctx.shadowBlur = 0; // Reset shadow

    // Draw custom overlay layers (only for Pro/Enterprise)
    if (userTier !== 'free') {
        canvasLayers.forEach(layer => {
            ctx.save();
            ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
            if (layer.type === 'text') {
                let fontStyle = '';
                if (layer.italic) fontStyle += 'italic ';
                if (layer.bold) fontStyle += 'bold ';
                ctx.font = `${fontStyle}${layer.fontSize}px '${layer.fontFamily}', sans-serif`;
                ctx.fillStyle = layer.color || '#000000';
                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillText(layer.text, layer.x, layer.y);
            } else if (layer.type === 'image' && layer.src) {
                const img = imageCache[layer.src];
                if (img) {
                    ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
                } else {
                    getCachedImage(layer.src, () => drawPoster());
                }
            }
            ctx.restore();
        });
    }

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

function setupCanvasInteraction() {
    const canvas = document.getElementById('poster-canvas');
    if (!canvas) return;

    function getCanvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: ((clientX - rect.left) / rect.width) * canvas.width,
            y: ((clientY - rect.top) / rect.height) * canvas.height
        };
    }

    function onStart(e) {
        if (userTier === 'free') return;
        const coords = getCanvasCoords(e);
        const mouseX = coords.x;
        const mouseY = coords.y;

        // Check if clicked inside any layer (loop backwards to select topmost layer first)
        for (let i = canvasLayers.length - 1; i >= 0; i--) {
            const layer = canvasLayers[i];
            let hit = false;
            if (layer.type === 'text') {
                const textWidth = layer.text.length * (layer.fontSize * 0.6);
                const textHeight = layer.fontSize;
                if (mouseX >= layer.x && mouseX <= layer.x + textWidth &&
                    mouseY >= layer.y && mouseY <= layer.y + textHeight) {
                    hit = true;
                }
            } else if (layer.type === 'image') {
                if (mouseX >= layer.x && mouseX <= layer.x + layer.width &&
                    mouseY >= layer.y && mouseY <= layer.y + layer.height) {
                    hit = true;
                }
            }

            if (hit) {
                activeDragElement = {
                    type: 'layer',
                    id: layer.id,
                    offsetX: mouseX - layer.x,
                    offsetY: mouseY - layer.y
                };
                e.preventDefault();
                return;
            }
        }

        // Check if clicked inside QR code
        if (mouseX >= qrPosition.x && mouseX <= qrPosition.x + qrPosition.size &&
            mouseY >= qrPosition.y && mouseY <= qrPosition.y + qrPosition.size) {
            activeDragElement = {
                type: 'qr',
                offsetX: mouseX - qrPosition.x,
                offsetY: mouseY - qrPosition.y
            };
            e.preventDefault();
            return;
        }
    }

    function onMove(e) {
        if (!activeDragElement) return;
        const coords = getCanvasCoords(e);
        const mouseX = coords.x;
        const mouseY = coords.y;

        if (activeDragElement.type === 'layer') {
            const layer = canvasLayers.find(l => l.id === activeDragElement.id);
            if (layer) {
                layer.x = Math.round(mouseX - activeDragElement.offsetX);
                layer.y = Math.round(mouseY - activeDragElement.offsetY);
                layer.x = Math.max(-100, Math.min(canvas.width, layer.x));
                layer.y = Math.max(-100, Math.min(canvas.height, layer.y));
                drawPoster();
            }
        } else if (activeDragElement.type === 'qr') {
            qrPosition.x = Math.round(mouseX - activeDragElement.offsetX);
            qrPosition.y = Math.round(mouseY - activeDragElement.offsetY);
            qrPosition.x = Math.max(0, Math.min(canvas.width - qrPosition.size, qrPosition.x));
            qrPosition.y = Math.max(0, Math.min(canvas.height - qrPosition.size, qrPosition.y));
            drawPoster();
        }
        e.preventDefault();
    }

    function onEnd() {
        activeDragElement = null;
    }

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);

    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
}

function renderLayersUI() {
    const container = document.getElementById('layers-container');
    if (!container) return;

    const noLayersMsg = document.getElementById('no-layers-msg');
    if (canvasLayers.length === 0) {
        container.innerHTML = '';
        if (noLayersMsg) {
            noLayersMsg.style.display = 'block';
            container.appendChild(noLayersMsg);
        }
        return;
    }

    if (noLayersMsg) noLayersMsg.style.display = 'none';
    container.innerHTML = '';

    canvasLayers.forEach(layer => {
        const div = document.createElement('div');
        div.className = 'layer-control-card';
        div.style.cssText = 'display:flex; flex-direction:column; gap:0.4rem;';
        
        let specificControls = '';
        if (layer.type === 'text') {
            specificControls = `
                <input type="text" class="layer-text-input form-input" value="${layer.text}" placeholder="Text content" style="padding:0.3rem 0.5rem; font-size:0.75rem;">
                <div style="display:flex; gap:0.3rem; align-items:center;">
                    <select class="layer-font-family form-input" style="padding:0.2rem; font-size:0.75rem; flex:1;">
                        <option value="Inter" ${layer.fontFamily === 'Inter' ? 'selected' : ''}>Inter</option>
                        <option value="Montserrat" ${layer.fontFamily === 'Montserrat' ? 'selected' : ''}>Montserrat</option>
                        <option value="Outfit" ${layer.fontFamily === 'Outfit' ? 'selected' : ''}>Outfit</option>
                        <option value="Pacifico" ${layer.fontFamily === 'Pacifico' ? 'selected' : ''}>Pacifico</option>
                        <option value="Playfair Display" ${layer.fontFamily === 'Playfair Display' ? 'selected' : ''}>Playfair Display</option>
                        <option value="Impact" ${layer.fontFamily === 'Impact' ? 'selected' : ''}>Impact</option>
                        <option value="Courier New" ${layer.fontFamily === 'Courier New' ? 'selected' : ''}>Courier New</option>
                    </select>
                    <input type="color" class="layer-color-input" value="${layer.color || '#ffffff'}" style="width:28px; height:24px; border:none; padding:0; cursor:pointer; background:none;">
                </div>
                <div style="display:flex; gap:0.4rem; align-items:center; justify-content:space-between; font-size:0.7rem;">
                    <label style="display:flex; align-items:center; gap:0.2rem; cursor:pointer;">
                        <input type="checkbox" class="layer-bold-checkbox" ${layer.bold ? 'checked' : ''}> Bold
                    </label>
                    <label style="display:flex; align-items:center; gap:0.2rem; cursor:pointer;">
                        <input type="checkbox" class="layer-italic-checkbox" ${layer.italic ? 'checked' : ''}> Italic
                    </label>
                    <div style="display:flex; align-items:center; gap:0.2rem;">
                        <span>Size:</span>
                        <input type="number" class="layer-size-input form-input" value="${layer.fontSize}" min="10" max="150" style="width:45px; padding:0.1rem 0.2rem; font-size:0.7rem;">
                    </div>
                </div>
            `;
        } else if (layer.type === 'image') {
            specificControls = `
                <div style="display:flex; gap:0.4rem; align-items:center; font-size:0.7rem; justify-content:space-between;">
                    <div style="display:flex; align-items:center; gap:0.2rem;">
                        <span>W:</span>
                        <input type="number" class="layer-w-input form-input" value="${layer.width}" min="10" max="800" style="width:45px; padding:0.1rem 0.2rem; font-size:0.7rem;">
                    </div>
                    <div style="display:flex; align-items:center; gap:0.2rem;">
                        <span>H:</span>
                        <input type="number" class="layer-h-input form-input" value="${layer.height}" min="10" max="800" style="width:45px; padding:0.1rem 0.2rem; font-size:0.7rem;">
                    </div>
                    <div style="display:flex; align-items:center; gap:0.2rem;">
                        <span>Opac:</span>
                        <input type="number" class="layer-opacity-input form-input" value="${layer.opacity !== undefined ? layer.opacity : 1}" min="0.1" max="1" step="0.1" style="width:40px; padding:0.1rem 0.2rem; font-size:0.7rem;">
                    </div>
                </div>
            `;
        }

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.2rem;">
                <strong style="color:var(--primary); text-transform:capitalize; font-size:0.75rem;">${layer.type} Layer</strong>
                <button class="layer-delete-btn" style="background:none; border:none; color:#ef4444; font-size:0.8rem; cursor:pointer; font-weight:bold;">✕</button>
            </div>
            ${specificControls}
        `;

        if (layer.type === 'text') {
            const txtInput = div.querySelector('.layer-text-input');
            txtInput.addEventListener('input', () => {
                layer.text = txtInput.value;
                drawPoster();
            });

            const fontSel = div.querySelector('.layer-font-family');
            fontSel.addEventListener('change', () => {
                layer.fontFamily = fontSel.value;
                drawPoster();
            });

            const colorIn = div.querySelector('.layer-color-input');
            colorIn.addEventListener('input', () => {
                layer.color = colorIn.value;
                drawPoster();
            });

            const boldCb = div.querySelector('.layer-bold-checkbox');
            boldCb.addEventListener('change', () => {
                layer.bold = boldCb.checked;
                drawPoster();
            });

            const italicCb = div.querySelector('.layer-italic-checkbox');
            italicCb.addEventListener('change', () => {
                layer.italic = italicCb.checked;
                drawPoster();
            });

            const sizeIn = div.querySelector('.layer-size-input');
            sizeIn.addEventListener('input', () => {
                layer.fontSize = parseInt(sizeIn.value) || 20;
                drawPoster();
            });
        } else if (layer.type === 'image') {
            const wIn = div.querySelector('.layer-w-input');
            wIn.addEventListener('input', () => {
                layer.width = parseInt(wIn.value) || 100;
                drawPoster();
            });

            const hIn = div.querySelector('.layer-h-input');
            hIn.addEventListener('input', () => {
                layer.height = parseInt(hIn.value) || 100;
                drawPoster();
            });

            const opacIn = div.querySelector('.layer-opacity-input');
            opacIn.addEventListener('input', () => {
                layer.opacity = parseFloat(opacIn.value) || 1;
                drawPoster();
            });
        }

        div.querySelector('.layer-delete-btn').addEventListener('click', () => {
            canvasLayers = canvasLayers.filter(l => l.id !== layer.id);
            renderLayersUI();
            drawPoster();
        });

        container.appendChild(div);
    });
}

function setupCanvasLayersSystem() {
    const bgInput = document.getElementById('bg-image-upload');
    const removeBgBtn = document.getElementById('remove-bg-image-btn');
    const addTextBtn = document.getElementById('add-text-layer-btn');
    const addImageBtn = document.getElementById('add-image-layer-btn');

    if (bgInput) {
        bgInput.addEventListener('change', function(e) {
            if (userTier === 'free') {
                bgInput.value = '';
                showUpgradeModal('Custom Backgrounds');
                return;
            }
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(event) {
                uploadedBgImageDataUrl = event.target.result;
                removeBgBtn.style.display = 'block';
                drawPoster();
            };
            reader.readAsDataURL(file);
        });
    }

    if (removeBgBtn) {
        removeBgBtn.addEventListener('click', () => {
            uploadedBgImageDataUrl = null;
            if (bgInput) bgInput.value = '';
            removeBgBtn.style.display = 'none';
            drawPoster();
        });
    }

    if (addTextBtn) {
        addTextBtn.addEventListener('click', () => {
            if (userTier === 'free') {
                showUpgradeModal('Custom Text Overlay Layers');
                return;
            }
            const newLayer = {
                id: 'text_' + Date.now(),
                type: 'text',
                text: 'New Customizable Text',
                x: 100,
                y: 150 + (canvasLayers.length * 30),
                fontSize: 36,
                fontFamily: 'Montserrat',
                color: '#ffffff',
                bold: true,
                italic: false
            };
            canvasLayers.push(newLayer);
            renderLayersUI();
            drawPoster();
        });
    }

    if (addImageBtn) {
        addImageBtn.addEventListener('click', () => {
            if (userTier === 'free') {
                showUpgradeModal('Custom Image Overlay Layers');
                return;
            }
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.onchange = function(e) {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = function(event) {
                    const newLayer = {
                        id: 'image_' + Date.now(),
                        type: 'image',
                        src: event.target.result,
                        x: 250,
                        y: 250,
                        width: 150,
                        height: 150,
                        opacity: 1.0
                    };
                    canvasLayers.push(newLayer);
                    renderLayersUI();
                    drawPoster();
                };
                reader.readAsDataURL(file);
            };
            fileInput.click();
        });
    }

    setupCanvasInteraction();
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

function downloadPosterFile(imageData, filename) {
    const link = document.createElement('a');
    link.href = imageData;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function waitForPosterCanvas() {
    return new Promise((resolve, reject) => {
        generatePreview();
        setTimeout(() => {
            const rawCanvas = document.querySelector('#qr-code-raw canvas');
            if (!rawCanvas) {
                reject(new Error('QR code not ready. Click "Generate Preview" and try again.'));
                return;
            }
            drawPoster();
            const canvas = document.getElementById('poster-canvas');
            if (!canvas) {
                reject(new Error('Poster canvas not found.'));
                return;
            }
            resolve(canvas);
        }, 120);
    });
}

async function getSavedPosterCount(userId) {
    const { count: wifiCount, error: wifiError } = await supabaseClient
        .from('wifi_qrs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
    const { count: linkCount, error: linkError } = await supabaseClient
        .from('link_qrs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

    if (wifiError) throw wifiError;
    if (linkError) throw linkError;
    return (wifiCount || 0) + (linkCount || 0);
}

// Download Button Event
document.getElementById('download-btn').addEventListener('click', async () => {
    const btn = document.getElementById('download-btn');
    const originalText = btn.innerText;
    btn.innerText = 'Preparing download...';
    btn.disabled = true;

    try {
        const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
        if (activeTab === 'analytics') {
            alert('Switch to the Wi-Fi or URL tab to download your QR poster.');
            return;
        }

        const { data: sessionData } = await supabaseClient.auth.getSession();
        const session = sessionData?.session;
        if (!session) {
            alert('Please log in again to download your poster.');
            window.location.replace('login.html');
            return;
        }

        if (userTier === 'free') {
            btn.innerText = 'Checking limits...';
            const totalSaved = await getSavedPosterCount(session.user.id);
            if (totalSaved >= 3) {
                alert('You have reached the limit of 3 saved QR codes for the Free tier. Please upgrade to Pro for increased limits!');
                showUpgradeModal('Saved QR Codes Limits');
                return;
            }

            const balanceInfo = await getTokenBalance(session.user.id);
            if (balanceInfo.tokens < 2) {
                alert(`Insufficient tokens!\n\nYou need 2 tokens to download a QR poster on the Free tier. Your current balance is ${balanceInfo.tokens} tokens.`);
                showUpgradeModal('QR Code Download');
                return;
            }

            btn.innerText = 'Processing tokens...';
            const deductResult = await deductTokens(session.user.id, 2);
            if (!deductResult.success) {
                alert(`Token deduction failed: ${deductResult.error}`);
                return;
            }
            if (typeof injectUnifiedDropdown === 'function') {
                await injectUnifiedDropdown('.dashboard-nav');
            }
        }

        btn.innerText = 'Rendering poster...';
        const canvas = await waitForPosterCanvas();
        let imageData;
        try {
            imageData = canvas.toDataURL('image/png');
        } catch (canvasErr) {
            console.error('Canvas export failed:', canvasErr);
            alert('Could not export the poster image. If you uploaded a logo, try removing it and generate again.');
            return;
        }

        let name = 'Link';
        const connectionType = activeTab === 'wifi' ? currentWtype : null;
        if (activeTab === 'wifi') {
            name = (document.getElementById('ssid').value || 'WiFi').trim() || 'WiFi';
        }

        btn.innerText = 'Saving & Downloading...';

        try {
            await ensureUserProfile(session);
            const tokensSpent = userTier === 'free' ? 2 : 0;

            if (activeTab === 'wifi') {
                const { error } = await supabaseClient.from('wifi_qrs').insert({
                    user_id: session.user.id,
                    ssid: name,
                    connection_type: connectionType || 'wifi',
                    template_name: currentTemplate,
                    qr_image_data: imageData,
                    tokens_spent: tokensSpent
                });
                if (error) console.error('DB Insert Error:', error.message);
            } else {
                const { error } = await supabaseClient.from('link_qrs').insert({
                    user_id: session.user.id,
                    url: document.getElementById('url').value,
                    template_name: currentTemplate,
                    qr_image_data: imageData,
                    tokens_spent: tokensSpent
                });
                if (error) console.error('DB Insert Error:', error.message);
            }
        } catch (e) {
            console.error('Error saving to database:', e);
        }

        const typeSuffix = connectionType === 'hotspot' ? 'Hotspot' : connectionType === 'wifi' ? 'WiFi' : '';
        const safeName = name.replace(/[<>:"/\\|?*]+/g, '_').slice(0, 40);
        const filename = typeSuffix
            ? `${safeName}_${currentTemplate}_${typeSuffix}_QR.png`
            : `${safeName}_${currentTemplate}_QR.png`;

        downloadPosterFile(imageData, filename);
    } catch (err) {
        console.error('Download failed:', err);
        alert(err.message || 'Download failed. Please try again.');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
});

// Initial generation
window.onload = generatePreview;
