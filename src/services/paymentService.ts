/**
 * Payment Service — abstraction over Moyasar and PayTabs.
 *
 * Real-world flow:
 *   1. The seller clicks "Subscribe" — we call createCheckoutSession()
 *   2. The browser is redirected to Moyasar/PayTabs hosted page
 *   3. After payment, the gateway hits a server-side webhook (deploy as a
 *      Supabase Edge Function, separate from this file). The webhook calls
 *      `confirm_subscription_payment(payment_id, gateway_ref)` RPC.
 *   4. The merchant_subscription transitions to `active` in real-time.
 *
 * This file deliberately ONLY constructs the redirect URL — sensitive secret
 * keys must NEVER touch the browser. The Edge Function holds the secret.
 *
 * The whole module is also gated by platform_settings.payment_gateway_enabled
 * so an admin can flip the entire app to "free mode" with a single toggle.
 */
import { platformSettingsRepository, PlatformSettings } from '../repositories/platformSettingsRepository';
import { logger } from '../utils/logger';

export interface CheckoutRequest {
    merchantId: string;
    subscriptionId: string;
    planId: string;
    amountSar: number;
    description: string;
    branchesCount: number;
    successUrl: string;
    cancelUrl: string;
}

export interface CheckoutResult {
    /** Set when the gateway is hidden — UI should treat the operation as free. */
    gatewayHidden: boolean;
    /** Hosted checkout URL. Browser should redirect to this. */
    checkoutUrl?: string;
    /** Internal payment id (set once an Edge Function returns). */
    paymentId?: string;
    /** Provider used for the checkout session. */
    provider?: 'moyasar' | 'paytabs';
    /** Human-readable error to show. */
    error?: string;
}

export const paymentService = {
    isGatewayEnabled: async (): Promise<boolean> => {
        const s = await platformSettingsRepository.fetchAll();
        return !!s.paymentGatewayEnabled;
    },

    /**
     * Triggers a checkout. When the gateway is disabled (admin toggle),
     * returns gatewayHidden:true so callers can show a "free / contact us"
     * UI instead.
     */
    createCheckoutSession: async (req: CheckoutRequest): Promise<CheckoutResult> => {
        let settings: PlatformSettings;
        try {
            settings = await platformSettingsRepository.fetchAll();
        } catch (e: any) {
            return { gatewayHidden: true, error: e?.message };
        }

        if (!settings.paymentGatewayEnabled) {
            return { gatewayHidden: true };
        }

        // The actual session-creation call must be done server-side because
        // Moyasar/PayTabs require the SECRET key (not the publishable key).
        // We POST to a Supabase Edge Function or your own backend; the URL
        // lives in env, defaulting to /api/checkout for local dev.
        const endpoint = (process.env.PAYMENT_CHECKOUT_ENDPOINT || '/api/checkout').replace(/\/$/, '');
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: settings.paymentGatewayProvider,
                    merchant_id: req.merchantId,
                    subscription_id: req.subscriptionId,
                    plan_id: req.planId,
                    amount_sar: req.amountSar,
                    description: req.description,
                    branches_count: req.branchesCount,
                    success_url: req.successUrl,
                    cancel_url: req.cancelUrl
                })
            });
            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                return { gatewayHidden: false, provider: settings.paymentGatewayProvider, error: `Gateway ${res.status}: ${txt || 'unknown'}` };
            }
            const json = await res.json();
            return {
                gatewayHidden: false,
                provider: settings.paymentGatewayProvider,
                checkoutUrl: json.checkout_url,
                paymentId: json.payment_id
            };
        } catch (e: any) {
            logger.warn('Checkout session failed:', e?.message || e);
            return { gatewayHidden: false, provider: settings.paymentGatewayProvider, error: e?.message || 'network' };
        }
    }
};
