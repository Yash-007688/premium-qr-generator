// Homepage Auth and Dynamic Navigation Manager
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            // 1. Inject Unified Dropdown inside navbar links container
            await injectUnifiedDropdown('.nav-links');

            // 1.5 Hide old login/signup buttons in nav
            const loginBtn = document.querySelector('.nav-links .login-btn');
            const signupBtn = document.querySelector('.nav-links .signup-btn');
            if (loginBtn) loginBtn.style.display = 'none';
            if (signupBtn) signupBtn.style.display = 'none';

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
