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

        // Call Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) {
            showError(loginForm, error.message);
            btn.innerText = originalText;
            btn.style.opacity = "1";
            btn.disabled = false;
        } else {
            // Success
            window.location.href = "dashboard.html";
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

        // Call Supabase
        const { data, error } = await supabase.auth.signUp({
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
                // Auto-login worked
                window.location.href = "dashboard.html";
            } else {
                // Email confirmation required
                showError(signupForm, "Account created! Please check your email to verify.");
                btn.innerText = "Verify Email";
            }
        }
    });
}
