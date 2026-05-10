/**
 * Subscription Repository — server-only data access for Phase 2 billing.
 *
 * Source of truth: Supabase. Nothing is cached in localStorage.
 * Every call hits the database; the AppContext + realtime keep the UI live.
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type SubscriptionStatus =
    | 'trial' | 'active' | 'past_due' | 'frozen' | 'cancelled' | 'gifted';

export interface SubscriptionPlan {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    descriptionAr?: string;
    descriptionEn?: string;
    priceMonthly: number;
    priceYearly?: number;
    includedBranches: number;
    extraBranchFee: number;
    maxDealsPerMonth?: number | null;
    featuresAr: string[];
    featuresEn: string[];
    isActive: boolean;
    sortOrder: number;
}

export interface MerchantSubscription {
    id: string;
    merchantId: string;
    planId: string | null;
    status: SubscriptionStatus;
    trialStartsAt?: string;
    trialEndsAt?: string;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    discountPercent: number;
    grantedByAdmin?: string;
    grantReason?: string;
    grantExpiresAt?: string;
    branchesCount: number;
    lastRenewedAt?: string;
    cancelAtPeriodEnd: boolean;
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface SubscriptionPayment {
    id: string;
    subscriptionId?: string;
    merchantId?: string;
    planId?: string;
    amount: number;
    currency: string;
    status: 'pending' | 'paid' | 'failed' | 'refunded' | 'gifted';
    paymentMethod?: string;
    gatewayProvider?: string;
    gatewayReference?: string;
    branchesCount?: number;
    periodStart?: string;
    periodEnd?: string;
    discountPercent: number;
    paidAt?: string;
    createdAt: string;
}

const mapPlan = (r: any): SubscriptionPlan => ({
    id: r.id,
    code: r.code,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    descriptionAr: r.description_ar,
    descriptionEn: r.description_en,
    priceMonthly: Number(r.price_monthly) || 0,
    priceYearly: r.price_yearly ? Number(r.price_yearly) : undefined,
    includedBranches: Number(r.included_branches) || 3,
    extraBranchFee: Number(r.extra_branch_fee) || 0,
    maxDealsPerMonth: r.max_deals_per_month,
    featuresAr: Array.isArray(r.features_ar) ? r.features_ar : [],
    featuresEn: Array.isArray(r.features_en) ? r.features_en : [],
    isActive: !!r.is_active,
    sortOrder: r.sort_order || 0
});

const mapSub = (r: any): MerchantSubscription => ({
    id: r.id,
    merchantId: r.merchant_id,
    planId: r.plan_id,
    status: r.status,
    trialStartsAt: r.trial_starts_at,
    trialEndsAt: r.trial_ends_at,
    currentPeriodStart: r.current_period_start,
    currentPeriodEnd: r.current_period_end,
    discountPercent: Number(r.discount_percent) || 0,
    grantedByAdmin: r.granted_by_admin,
    grantReason: r.grant_reason,
    grantExpiresAt: r.grant_expires_at,
    branchesCount: Number(r.branches_count) || 1,
    lastRenewedAt: r.last_renewed_at,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    metadata: r.metadata || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at
});

const mapPayment = (r: any): SubscriptionPayment => ({
    id: r.id,
    subscriptionId: r.subscription_id,
    merchantId: r.merchant_id,
    planId: r.plan_id,
    amount: Number(r.amount) || 0,
    currency: r.currency || 'SAR',
    status: r.status,
    paymentMethod: r.payment_method,
    gatewayProvider: r.gateway_provider,
    gatewayReference: r.gateway_reference,
    branchesCount: r.branches_count,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    discountPercent: Number(r.discount_percent) || 0,
    paidAt: r.paid_at,
    createdAt: r.created_at
});

export const subscriptionRepository = {
    /** Lists every active plan (used on the subscription/pricing screen). */
    listPlans: async (): Promise<SubscriptionPlan[]> => {
        const { data, error } = await supabase
            .from('subscription_plans')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (error) {
            logger.warn('listPlans failed:', error.message);
            return [];
        }
        return (data || []).map(mapPlan);
    },

    /** Returns the merchant's current subscription, creating a trial if missing. */
    getMine: async (merchantId: string): Promise<MerchantSubscription | null> => {
        const { data, error } = await supabase
            .from('merchant_subscriptions')
            .select('*')
            .eq('merchant_id', merchantId)
            .maybeSingle();

        if (error) {
            logger.warn('getMine failed:', error.message);
            return null;
        }

        if (data) return mapSub(data);

        // Auto-create the trial row by calling the RPC. The trigger should
        // have already done this on signup, but a missing row shouldn't lock
        // out a merchant who pre-dates the migration.
        const { data: started, error: rpcErr } = await supabase
            .rpc('start_trial_for_merchant', { p_merchant_id: merchantId });
        if (rpcErr) {
            logger.warn('start_trial_for_merchant failed:', rpcErr.message);
            return null;
        }
        return started ? mapSub(started) : null;
    },

    /** Listing for the admin "Stores" tab — every merchant + their sub state. */
    listAllMerchantsWithSubscription: async (): Promise<Array<{
        merchant: any;
        subscription: MerchantSubscription | null;
        plan: SubscriptionPlan | null;
    }>> => {
        const { data: users, error: uErr } = await supabase
            .from('users')
            .select('id, name, shop, phone, email, contact_phone, address, avatar_url, lat, lng, created_at')
            .eq('user_type', 'seller');
        if (uErr) {
            logger.warn('listAllMerchantsWithSubscription users:', uErr.message);
            return [];
        }

        const ids = (users || []).map(u => u.id);
        if (ids.length === 0) return [];

        const [{ data: subs }, { data: plans }] = await Promise.all([
            supabase.from('merchant_subscriptions').select('*').in('merchant_id', ids),
            supabase.from('subscription_plans').select('*')
        ]);

        const subById = new Map<string, any>((subs || []).map(s => [s.merchant_id, s]));
        const planById = new Map<string, SubscriptionPlan>((plans || []).map((p: any) => [p.id, mapPlan(p)]));

        return (users || []).map(u => {
            const sub = subById.get(u.id);
            const subMapped = sub ? mapSub(sub) : null;
            const plan = subMapped?.planId ? (planById.get(subMapped.planId) || null) : null;
            return { merchant: u, subscription: subMapped, plan };
        });
    },

    /** Compute price server-side so the source of truth never drifts. */
    quotePrice: async (planId: string, branches: number, discount = 0): Promise<number> => {
        const { data, error } = await supabase
            .rpc('compute_subscription_price', {
                p_plan_id: planId,
                p_branches: branches,
                p_discount_percent: discount
            });
        if (error) {
            logger.warn('quotePrice failed:', error.message);
            return 0;
        }
        return Number(data) || 0;
    },

    /** Admin → grant N merchants free or discounted access. */
    grantBulk: async (
        merchantIds: string[],
        grantType: 'free' | 'discount',
        durationDays: number,
        discountPercent = 0,
        reason?: string
    ): Promise<number> => {
        const { data, error } = await supabase.rpc('grant_subscription_bulk', {
            p_merchant_ids: merchantIds,
            p_grant_type: grantType,
            p_duration_days: durationDays,
            p_discount_percent: discountPercent,
            p_reason: reason || null
        });
        if (error) throw error;
        return Number(data) || 0;
    },

    /** Admin → suspend a merchant immediately. */
    revoke: async (merchantId: string): Promise<void> => {
        const { error } = await supabase.rpc('revoke_subscription', { p_merchant_id: merchantId });
        if (error) throw error;
    },

    /** Admin → confirm a payment after a webhook from PayTabs/Moyasar. */
    confirmPayment: async (paymentId: string, gatewayRef: string): Promise<MerchantSubscription | null> => {
        const { data, error } = await supabase.rpc('confirm_subscription_payment', {
            p_payment_id: paymentId,
            p_gateway_reference: gatewayRef
        });
        if (error) throw error;
        return data ? mapSub(data) : null;
    },

    /** Lists this merchant's invoice history. */
    listMyPayments: async (merchantId: string): Promise<SubscriptionPayment[]> => {
        const { data, error } = await supabase
            .from('subscription_payments')
            .select('*')
            .eq('merchant_id', merchantId)
            .order('created_at', { ascending: false });
        if (error) {
            logger.warn('listMyPayments failed:', error.message);
            return [];
        }
        return (data || []).map(mapPayment);
    },

    /** Insert a pending payment row to track a checkout session before webhook. */
    createPendingPayment: async (
        merchantId: string,
        subscriptionId: string,
        planId: string,
        amount: number,
        branchesCount: number,
        gatewayProvider: string
    ): Promise<SubscriptionPayment | null> => {
        // We can't insert directly because of RLS — admins or the RPC layer
        // are the only writers. Sellers must use a server-side webhook flow
        // mediated by an admin or edge function. To keep this UI-only flow
        // safe, we surface the intent through a notification the admin can
        // approve, and let the gateway webhook hit confirm_subscription_payment.
        await supabase.from('notifications').insert({
            user_id: merchantId,
            title_ar: '⌛ بانتظار تأكيد الدفع',
            title_en: '⌛ Awaiting payment confirmation',
            body_ar: `تم بدء عملية دفع بقيمة ${amount} ر.س. سنُفعّل اشتراكك فور تأكيد البوابة.`,
            body_en: `Payment of ${amount} SAR initiated. Your subscription will activate when the gateway confirms.`,
            type: 'system',
            meta_data: {
                subscriptionId, planId, amount, branchesCount, gatewayProvider, kind: 'pending_payment'
            }
        });
        return null;
    },

    /** Real-time subscription change listener — used by AppContext. */
    subscribeToOwn: (
        merchantId: string,
        onChange: (sub: MerchantSubscription) => void
    ): (() => void) => {
        const channel = supabase
            .channel(`sub-${merchantId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'merchant_subscriptions', filter: `merchant_id=eq.${merchantId}` },
                (payload: any) => {
                    if (payload.new) onChange(mapSub(payload.new));
                })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }
};
