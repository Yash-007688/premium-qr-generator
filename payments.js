// Centralized Razorpay + Supabase payment/token handling

function getRazorpayKeyId() {
    const key = (window.APP_CONFIG && window.APP_CONFIG.RAZORPAY_KEY_ID) || '';
    return String(key).trim();
}

function isRazorpayConfigured() {
    const key = getRazorpayKeyId();
    return key.length > 0 && !key.includes('yourkey');
}

function openRazorpayCheckout({ amountInr, description, userName, userEmail, onSuccess, onDismiss }) {
    if (!isRazorpayConfigured()) {
        alert('Payment gateway not configured.\n\nAdd RAZORPAY_KEY_ID in .env / Vercel env vars, then run npm run build:config and redeploy.');
        if (onDismiss) onDismiss();
        return false;
    }

    if (typeof Razorpay === 'undefined') {
        alert('Razorpay failed to load. Check your internet connection and try again.');
        if (onDismiss) onDismiss();
        return false;
    }

    const options = {
        key: getRazorpayKeyId(),
        amount: Math.round(amountInr * 100),
        currency: 'INR',
        name: 'QR Web Generator',
        description,
        image: 'logo.png',
        handler: onSuccess,
        prefill: {
            name: userName || '',
            email: userEmail || ''
        },
        theme: { color: '#6366f1' },
        modal: {
            ondismiss: function () {
                if (onDismiss) onDismiss();
            }
        }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response) {
        const msg = response.error?.description || response.error?.reason || 'Payment failed';
        alert('Payment failed: ' + msg);
        if (onDismiss) onDismiss();
    });
    rzp.open();
    return true;
}

async function recordPayment({
    userId,
    amountInr,
    planName,
    tokensPurchased = 0,
    razorpayPaymentId,
    razorpayOrderId,
    status = 'success'
}) {
    const { error } = await supabaseClient.from('payments').insert({
        user_id: userId,
        amount: amountInr,
        plan_name: planName,
        tokens_purchased: tokensPurchased,
        payment_gateway: 'razorpay',
        razorpay_payment_id: razorpayPaymentId || null,
        razorpay_order_id: razorpayOrderId || null,
        status,
        updated_at: new Date().toISOString()
    });

    if (error) {
        console.error('Payment record failed:', error.message);
        return { success: false, error: error.message };
    }
    return { success: true, error: null };
}

async function processTokenPackPurchase(userId, tokensToAdd, amountInr, planName, razorpayResponse) {
    const credit = await addTokens(userId, tokensToAdd);
    if (!credit.success) {
        return { success: false, error: credit.error || 'Failed to credit tokens' };
    }

    await recordPayment({
        userId,
        amountInr,
        planName,
        tokensPurchased: tokensToAdd,
        razorpayPaymentId: razorpayResponse?.razorpay_payment_id,
        razorpayOrderId: razorpayResponse?.razorpay_order_id,
        status: 'success'
    });

    if (typeof updateNavbarTokenBadge === 'function') {
        updateNavbarTokenBadge(credit.newBalance);
    }

    return { success: true, newBalance: credit.newBalance, error: null };
}

async function processSubscriptionPurchase(userId, tier, amountInr, planName, razorpayResponse) {
    const { error } = await supabaseClient
        .from('profiles')
        .update({ tier })
        .eq('id', userId);

    if (error) {
        return { success: false, error: error.message };
    }

    await recordPayment({
        userId,
        amountInr,
        planName,
        tokensPurchased: 0,
        razorpayPaymentId: razorpayResponse?.razorpay_payment_id,
        razorpayOrderId: razorpayResponse?.razorpay_order_id,
        status: 'success'
    });

    return { success: true, tier, error: null };
}
