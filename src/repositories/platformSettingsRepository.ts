/**
 * Platform Settings Repository — admin-controlled global flags.
 * The most important one is `payment_gateway_enabled`: a single boolean
 * that hides all checkout UI when false (free-mode toggle).
 */
import { supabase } from '../services/supabaseClient';
import { logger } from '../utils/logger';

export type SettingKey =
    | 'payment_gateway_enabled'
    | 'payment_gateway_provider'
    | 'payment_publishable_key'
    | 'basic_plan_price_sar'
    | 'extra_branch_fee_sar'
    | 'included_branches'
    | 'trial_days'
    | 'trial_warning_days_before';

export interface PlatformSettings {
    paymentGatewayEnabled: boolean;
    paymentGatewayProvider: 'moyasar' | 'paytabs';
    paymentPublishableKey: string;
    basicPlanPriceSar: number;
    extraBranchFeeSar: number;
    includedBranches: number;
    trialDays: number;
    trialWarningDaysBefore: number;
}

const DEFAULTS: PlatformSettings = {
    paymentGatewayEnabled: false,
    paymentGatewayProvider: 'moyasar',
    paymentPublishableKey: '',
    basicPlanPriceSar: 99,
    extraBranchFeeSar: 25,
    includedBranches: 3,
    trialDays: 14,
    trialWarningDaysBefore: 3
};

const parseValue = <T>(raw: any, fallback: T): T => {
    if (raw === null || raw === undefined) return fallback;
    if (typeof raw === 'object' && raw !== null && 'value' in raw) raw = raw.value;
    if (typeof raw === 'string' && (raw === 'true' || raw === 'false')) return (raw === 'true') as any;
    return raw as T;
};

export const platformSettingsRepository = {
    fetchAll: async (): Promise<PlatformSettings> => {
        const { data, error } = await supabase.from('platform_settings').select('key, value');
        if (error) {
            logger.warn('platform_settings fetch failed:', error.message);
            return DEFAULTS;
        }
        const map = new Map<string, any>((data || []).map(r => [r.key, r.value]));
        return {
            paymentGatewayEnabled: parseValue<boolean>(map.get('payment_gateway_enabled'), DEFAULTS.paymentGatewayEnabled),
            paymentGatewayProvider: parseValue<'moyasar' | 'paytabs'>(map.get('payment_gateway_provider'), DEFAULTS.paymentGatewayProvider),
            paymentPublishableKey: parseValue<string>(map.get('payment_publishable_key'), DEFAULTS.paymentPublishableKey),
            basicPlanPriceSar: Number(parseValue(map.get('basic_plan_price_sar'), DEFAULTS.basicPlanPriceSar)),
            extraBranchFeeSar: Number(parseValue(map.get('extra_branch_fee_sar'), DEFAULTS.extraBranchFeeSar)),
            includedBranches: Number(parseValue(map.get('included_branches'), DEFAULTS.includedBranches)),
            trialDays: Number(parseValue(map.get('trial_days'), DEFAULTS.trialDays)),
            trialWarningDaysBefore: Number(parseValue(map.get('trial_warning_days_before'), DEFAULTS.trialWarningDaysBefore))
        };
    },

    /** Admin-only — RLS will reject other callers. */
    set: async (key: SettingKey, value: any): Promise<void> => {
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key, value }, { onConflict: 'key' });
        if (error) throw error;
    },

    /** Convenience: hide / show payment UI globally. */
    setPaymentGatewayEnabled: async (enabled: boolean): Promise<void> => {
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'payment_gateway_enabled', value: enabled }, { onConflict: 'key' });
        if (error) throw error;
    },

    subscribe: (onChange: (settings: PlatformSettings) => void): (() => void) => {
        const ch = supabase
            .channel('platform_settings_realtime')
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'platform_settings' },
                async () => {
                    try {
                        const fresh = await platformSettingsRepository.fetchAll();
                        onChange(fresh);
                    } catch {}
                })
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }
};
