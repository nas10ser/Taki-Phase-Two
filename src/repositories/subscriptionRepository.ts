import { supabase } from '../services/supabaseClient';

export interface SubscriptionStatus {
    plan: string;
    expiresAt: string | null;
    isPinned: boolean;
    maxBranches: number;
}

export const subscriptionRepository = {
    async getStoreSubscription(storeId: string): Promise<SubscriptionStatus | null> {
        const { data, error } = await supabase
            .from('store_profiles')
            .select('subscription_plan, subscription_expires_at, is_pinned, max_branches')
            .eq('store_id', storeId)
            .single();
        
        if (error) {
            console.error('Error fetching subscription:', error);
            return null;
        }

        return {
            plan: data.subscription_plan || 'free',
            expiresAt: data.subscription_expires_at,
            isPinned: data.is_pinned || false,
            maxBranches: data.max_branches || 3
        };
    },

    async updateSubscription(storeId: string, plan: string, days: number): Promise<void> {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const { error } = await supabase
            .from('store_profiles')
            .upsert({
                store_id: storeId,
                subscription_plan: plan,
                subscription_expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString()
            });
        
        if (error) throw error;
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
    }
};
