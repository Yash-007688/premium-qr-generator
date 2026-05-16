// Auto-redirect if already logged in
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await redirectByRole(session.user.id);
    }
});

// ── Google OAuth (secret lives in Supabase Dashboard, not in .env frontend) ──
const GOOGLE_BTN_HTML = `
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 28.991 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
        <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C33.64 6.053 28.991 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.05 12.05 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
    <span>Continue with Google</span>
`;

function setupGoogleSignIn() {
    document.querySelectorAll('.google-btn').forEach((googleBtn) => {
        const originalHtml = googleBtn.innerHTML.trim() || GOOGLE_BTN_HTML;
        googleBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            googleBtn.disabled = true;
            googleBtn.innerHTML = '<span>Redirecting...</span>';
            try {
                const redirectTo = getOAuthRedirectUrl();
                const { data, error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo,
                        skipBrowserRedirect: false
                    }
                });
                if (error) {
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHtml;
                    alert('Google sign-in failed: ' + error.message);
                    return;
                }
                if (data?.url) {
                    window.location.href = data.url;
                }
            } catch (err) {
                googleBtn.disabled = false;
                googleBtn.innerHTML = originalHtml;
                alert('Error: ' + (err.message || 'Could not start Google sign-in'));
            }
        });
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupGoogleSignIn);
} else {
    setupGoogleSignIn();
}

const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

// Helper to show errors beautifully
function showError(form, message) {
    let errorEl = form.querySelector('.error-msg');
    if (!errorEl) {
        errorEl = document.createElement('p');
        errorEl.className = 'error-msg';
        errorEl.style.color = '#ef4444';
        errorEl.style.fontSize = '0.85rem';
        errorEl.style.marginTop = '-0.5rem';
        errorEl.style.textAlign = 'center';
        form.insertBefore(errorEl, form.querySelector('button[type="submit"]'));
    }
    errorEl.innerText = message;
}

// Handle Login
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.innerText = "Signing In...";
        btn.style.opacity = "0.7";
        btn.disabled = true;

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            // Call Supabase
            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                showError(loginForm, error.message);
                btn.innerText = originalText;
                btn.style.opacity = "1";
                btn.disabled = false;
            } else {
                await redirectByRole(data.user.id);
            }
        } catch (err) {
            console.error("Login Exception:", err);
            showError(loginForm, "Error: " + (err.message || JSON.stringify(err)));
            btn.innerText = originalText;
            btn.style.opacity = "1";
            btn.disabled = false;
        }
    });
}

// Handle Sign Up
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = signupForm.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.innerText = "Creating Account...";
        btn.style.opacity = "0.7";
        btn.disabled = true;

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            // Call Supabase
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: {
                        full_name: name
                    }
                }
            });

            if (error) {
                showError(signupForm, error.message);
                btn.innerText = originalText;
                btn.style.opacity = "1";
                btn.disabled = false;
            } else {
                if (data.session) {
                    await redirectByRole(data.session.user.id);
                } else {
                    // Email confirmation required
                    showError(signupForm, "Account created! Please check your email to verify.");
                    btn.innerText = "Verify Email";
                    btn.style.opacity = "1";
                    btn.disabled = false;
                }
            }
        } catch (err) {
            console.error("Signup Exception:", err);
            showError(signupForm, "Error: " + (err.message || JSON.stringify(err)));
            btn.innerText = originalText;
            btn.style.opacity = "1";
            btn.disabled = false;
        }
    });
}
