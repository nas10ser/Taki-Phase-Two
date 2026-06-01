import { supabase } from '../services/supabaseClient';

export interface SubscriptionStatus {
    plan: string;
    expiresAt: string | null;
    startedAt: string | null;
    amount: number;
    isPinned: boolean;
    maxBranches: number;
    /** v11.38 — auto-renew flag (default true) + cancellation timestamp. */
    autoRenew: boolean;
    canceledAt: string | null;
}

export const subscriptionRepository = {
    async getStoreSubscription(storeId: string): Promise<SubscriptionStatus | null> {
        const { data, error } = await supabase
            .from('store_profiles')
            .select('subscription_plan, subscription_expires_at, subscription_started_at, subscription_amount, is_pinned, max_branches, auto_renew, subscription_canceled_at')
            .eq('store_id', storeId)
            .single();

        if (error) {
            console.error('Error fetching subscription:', error);
            return null;
        }

        return {
            plan: data.subscription_plan || 'free',
            expiresAt: data.subscription_expires_at,
            startedAt: data.subscription_started_at,
            amount: Number(data.subscription_amount) || 0,
            isPinned: data.is_pinned || false,
            maxBranches: data.max_branches || 3,
            // Columns added in v11.38 — default safely for older cached rows.
            autoRenew: data.auto_renew !== false,
            canceledAt: data.subscription_canceled_at ?? null,
        };
    },

    /**
     * Self-serve activation/renew (v11.38). Writes the full mirror so the status
     * card has price + start date, re-enables auto-renew, clears any cancellation,
     * and restores deals that were auto-frozen on a previous expiry.
     */
    async updateSubscription(
        storeId: string,
        plan: string,
        days: number,
        opts?: { amount?: number; maxBranches?: number },
    ): Promise<void> {
        const now = new Date();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const payload: Record<string, any> = {
            store_id: storeId,
            subscription_plan: plan,
            subscription_started_at: now.toISOString(),
            subscription_expires_at: expiresAt.toISOString(),
            auto_renew: true,
            subscription_canceled_at: null,
            updated_at: now.toISOString(),
        };
        if (typeof opts?.amount === 'number') payload.subscription_amount = opts.amount;
        if (typeof opts?.maxBranches === 'number') payload.max_branches = opts.maxBranches;

        const { error } = await supabase.from('store_profiles').upsert(payload);
        if (error) throw error;

        // Bring back any deals paused by a prior expiry (best-effort).
        await this.restoreFrozenDeals(storeId);
    },

    async grantCustomSubscription(storeId: string, plan: string, expiresAt: string): Promise<void> {
        const { error } = await supabase
            .from('store_profiles')
            .upsert({
                store_id: storeId,
                subscription_plan: plan,
                subscription_expires_at: expiresAt,
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
    },

    /**
     * Cancel (keep the paid period) or resume auto-renew (v11.38).
     * p_on=false → auto-renew off + canceled stamp, access stays until expiry.
     * p_on=true  → auto-renew on, cancellation cleared, frozen deals restored.
     */
    async setAutoRenew(on: boolean): Promise<{ success: boolean; expiresAt?: string | null; error?: string }> {
        const { data, error } = await supabase.rpc('merchant_set_subscription_renew', { p_on: on });
        if (error) return { success: false, error: error.message };
        return { success: true, expiresAt: (data as any)?.expires_at ?? null };
    },

    /** Restore deals auto-paused on a previous expiry. Returns count restored. */
    async restoreFrozenDeals(storeId: string): Promise<number> {
        const { data, error } = await supabase.rpc('restore_frozen_deals', { p_store_id: storeId });
        if (error) { console.error('restoreFrozenDeals:', error); return 0; }
        return Number(data) || 0;
    },
};
