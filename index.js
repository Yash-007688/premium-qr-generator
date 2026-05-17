// Homepage Auth and Dynamic Navigation Manager
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            // 1. Inject Unified Dropdown inside navbar links container
            await injectUnifiedDropdown('.nav-links');

            // 2. Update CTA Hero Buttons
            const heroBtn = document.querySelector('.hero-btn');
            if (heroBtn) {
                heroBtn.textContent = 'Go to Dashboard';
                heroBtn.href = 'dashboard.html';
            }
        }
    } catch (err) {
        console.error("Homepage dynamic update failed:", err);
    }
});
