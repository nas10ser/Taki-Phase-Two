import { supabase } from './supabaseClient';
import { CONFIG } from '../config';

export interface UserProfile {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    userType: 'buyer' | 'seller' | 'admin';
    shop?: string;
    contactPhone?: string;
    address?: string;
    avatar_url?: string;
    bio?: string;
    savings?: number;
    bookingsCount?: number;
    notifKeywords?: string[]; // legacy — superseded by smartAlerts
    smartAlerts?: SmartAlertRule[];
    followedMerchants?: string[];
    blockedMerchants?: string[];
    preferredLang?: 'ar' | 'en';
    lat?: number;
    lng?: number;
    googleMapsLink?: string;
    workingHours?: any;   // ساعات عمل المحل (للتاجر) — see utils/workingHours
    // v11.19 — granular admin permissions. Super admin (Nasser) bypasses
    // every check; staff admins (`isSuperAdmin=false`) only see tabs/actions
    // whose key is present in `adminPermissions`. Both fields are loaded
    // from `public.users` and are also exposed via the `admin_my_permissions`
    // RPC for fresh reads after a privilege change.
    isSuperAdmin?: boolean;
    adminPermissions?: string[];
}

// v11.19 — canonical permission keys. Keep this list in sync with the
// migration (`v11_19_admin_permissions_system`) and with the Admin
// management UI. Adding a new key here is enough to let the super admin
// grant it; the consuming code decides what it gates.
export type AdminPermission =
    | 'tab_overview'
    | 'tab_buyers'
    | 'tab_sellers'
    | 'tab_reports'
    | 'tab_analytics'
    | 'tab_tools'
    | 'tab_messages'
    | 'tab_contests'
    | 'tab_launch'
    | 'tab_admins'
    | 'action_impersonate'
    | 'action_view_finance'
    | 'action_delete_deals'
    | 'action_manage_seasonal'
    | 'action_manage_campaigns'
    | 'action_manage_banners'
    | 'action_manage_users'
    | 'action_manage_sponsors'
    | 'action_moderate_messages';

export interface SmartAlertRule {
    regions?: string[];
    cities?: string[];
    malls?: string[];        // location ids
    categories?: string[];
    keywords?: string[];
    coords?: { lat: number; lng: number };
    radiusKm?: number;
}

export const authService = {
    // Current memory-only profile for synchronous checks
    _profile: null as UserProfile | null,
    getUser: (): UserProfile | null => {
        return authService._profile;
    },

    setUser: (profile: UserProfile): void => {
        authService._profile = profile;
    },

    logout: async (): Promise<void> => {
        // Clear local cache IMMEDIATELY
        authService._profile = null;
        localStorage.removeItem('supabase.auth.token');
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('auth-token')) {
                localStorage.removeItem(key);
            }
        });

        try { 
            await supabase.auth.signOut(); 
        } catch (e) { 
            console.error('Signout Error', e); 
        }
    },

    deleteAccount: async (): Promise<void> => {
        try {
            // Call the RPC function to delete the user account in Supabase
            await supabase.rpc('delete_user_account');
            await supabase.auth.signOut();
        } catch (e) {
            console.error('Delete Account Error', e);
        }
        authService._profile = null;
        localStorage.removeItem('supabase.auth.token');
    },

    isAuthenticated: (): boolean => {
        return authService.getUser() !== null;
    },

    isAdmin: (): boolean => {
        const user = authService.getUser();
        return !!user && user.userType === 'admin';
    },

    isSeller: (): boolean => {
        const user = authService.getUser();
        return user?.userType === 'seller' || user?.userType === 'admin';
    },

    // ----------------------------------------------------
    //                 REAL SUPABASE AUTH
    // ----------------------------------------------------

    signUpWithPhone: async (profile: UserProfile, password: string) => {
        if (!profile.phone) {
            return { data: null, error: { message: 'Phone is required for phone signup' } } as any;
        }
        return await supabase.auth.signUp({
            phone: profile.phone,
            email: profile.email,
            password,
            options: {
                data: {
                    name: profile.name,
                    phone: profile.phone,
                    user_type: profile.userType,
                    shop: profile.shop,
                    contact_phone: profile.contactPhone || profile.phone,
                    address: profile.address || '',
                    savings: profile.savings || 0,
                }
            }
        });
    },

    signUpWithEmail: async (email: string, password: string, userData: { name: string, phone: string, user_type: string, shop?: string | null, contact_phone?: string, address?: string, referral_source?: string | null, referral_source_detail?: string | null, referred_by_code?: string | null }) => {
        return await supabase.auth.signUp({
            email,
            password,
            options: {
                // Pin the confirmation link's redirect target to the current
                // origin (https://taki-test-eight.vercel.app in production,
                // or whatever the user's browser shows). Without this, Supabase
                // falls back to its configured Site URL — which defaults to
                // localhost:3000 — and the email link sends the user to a
                // dead "ERR_CONNECTION_REFUSED" page on their phone. The
                // origin still has to be in the project's Redirect-URL
                // allowlist; we document that step in progress.md for v10.55.
                emailRedirectTo: window.location.origin,
                data: {
                    name: userData.name,
                    phone: userData.phone,
                    user_type: userData.user_type,
                    shop: userData.shop || null,
                    contact_phone: userData.contact_phone || userData.phone,
                    address: userData.address || '',
                    // v12.30 — referral attribution; handle_new_user resolves
                    // referred_by_code → the owning store's id server-side.
                    referral_source: userData.referral_source || null,
                    referral_source_detail: userData.referral_source_detail || null,
                    referred_by_code: userData.referred_by_code || null,
                }
            }
        });
    },

    checkPhoneExists: async (phone: string): Promise<boolean> => {
        // Use the RPC so we hit every phone format and also auth.users
        // metadata. The plain users.phone eq() lookup missed numbers stored
        // as +966… or 966… and incorrectly told users their account did
        // not exist.
        try {
            const { data: email } = await supabase.rpc('find_email_by_phone', { input_phone: phone });
            return !!email;
        } catch (err) {
            console.error('Check phone error:', err);
            throw err;
        }
    },

    checkEmailExists: async (email: string): Promise<boolean> => {
        // v11.43: route through the SECURITY DEFINER `account_exists` RPC instead
        // of reading public.users directly. The users RLS policy no longer exposes
        // buyer rows to anon, so a direct table read would always miss buyers.
        try {
            const { data } = await supabase.rpc('account_exists', { p_email: email });
            return !!(data && (data as any).email_taken);
        } catch {}
        return false;
    },

    /**
     * Combined check: returns which fields are already taken
     * Used for real-time inline validation during registration.
     * v11.43: backed by the `account_exists` definer RPC (see checkEmailExists).
     */
    checkFieldsAvailability: async (email?: string, phone?: string): Promise<{ emailTaken: boolean; phoneTaken: boolean }> => {
        try {
            const { data } = await supabase.rpc('account_exists', { p_email: email ?? null, p_phone: phone ?? null });
            if (data) return { emailTaken: !!(data as any).email_taken, phoneTaken: !!(data as any).phone_taken };
        } catch {
            // Silently fail - don't block UX
        }
        return { emailTaken: false, phoneTaken: false };
    },

    verifyOtp: async (phoneOrEmail: string, token: string, type: 'sms' | 'email') => {
        if (type === 'sms') {
            return await supabase.auth.verifyOtp({ phone: phoneOrEmail, token, type: 'sms' });
        } else {
            return await supabase.auth.verifyOtp({ email: phoneOrEmail, token, type: 'email' });
        }
    },

    resendVerification: async (email: string) => {
        return await supabase.auth.resend({ type: 'signup', email });
    },

    signInWithPassword: async (identifier: string, password: string, type: 'phone' | 'email') => {
        if (type === 'phone') {
            // Normalize phone: digits only, strip 966/00966 country code
            let normalizedPhone = identifier.replace(/\D/g, '');
            if (normalizedPhone.startsWith('00966')) {
                normalizedPhone = '0' + normalizedPhone.slice(5);
            } else if (normalizedPhone.startsWith('966') && normalizedPhone.length > 10) {
                normalizedPhone = '0' + normalizedPhone.slice(3);
            }

            // Race the two paths in parallel so a slow RPC never gates login:
            //  - Path A: lookup the real email via RPC, then signIn
            //  - Path B: the legacy dummy-email pattern, signIn directly
            // Whichever returns a real auth user first wins. If both reject,
            // we surface the more informative error.
            const dummyEmail = `${normalizedPhone}@taki.app`;

            const lookupAttempt = (async () => {
                try {
                    const { data: rpcEmail } = await supabase.rpc('find_email_by_phone', { input_phone: normalizedPhone });
                    if (!rpcEmail) return { error: { message: 'no-rpc-match' } };
                    return await supabase.auth.signInWithPassword({ email: rpcEmail as string, password });
                } catch (err: any) {
                    return { error: { message: err?.message || 'rpc-failed' } };
                }
            })();

            const dummyAttempt = supabase.auth.signInWithPassword({ email: dummyEmail, password })
                .catch((err: any) => ({ error: { message: err?.message || 'dummy-failed' } } as any));

            // Fire both, return as soon as ONE produces a real authenticated user.
            const winner = await new Promise<any>((resolve) => {
                let settled = 0;
                let firstError: any = null;
                const tryResolve = (r: any) => {
                    settled++;
                    if (r?.data?.user) {
                        resolve(r);
                        return;
                    }
                    if (!firstError) firstError = r?.error || { message: 'unknown' };
                    if (settled === 2) {
                        const msg = String(firstError?.message || '').toLowerCase();
                        if (msg.includes('invalid login credentials')) {
                            resolve({ error: { message: 'كلمة المرور أو رقم الجوال غير صحيح، حاول مرة أخرى.' } });
                        } else if (msg.includes('no-rpc-match')) {
                            resolve({ error: { message: 'لم يتم العثور على حساب بهذا الرقم. تأكد من الرقم أو سجّل حساباً جديداً — وإن كان حسابك إدارياً فسجّل الدخول بالبريد الإلكتروني (حماية أمنية).' } });
                        } else {
                            resolve({ error: firstError });
                        }
                    }
                };
                lookupAttempt.then(tryResolve).catch(e => tryResolve({ error: { message: e?.message || 'rpc-failed' } }));
                dummyAttempt.then(tryResolve).catch(e => tryResolve({ error: { message: e?.message || 'dummy-failed' } }));
            });

            return winner;
        } else {
            return await supabase.auth.signInWithPassword({ email: identifier, password });
        }
    },

    // OAuth helpers — both use skipBrowserRedirect so the caller can catch
    // "provider is not enabled" / config errors and surface a friendly
    // Arabic message instead of letting Supabase navigate the user away
    // to a black JSON error page on supabase.co.
    signInWithApple: async () => {
        const result = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: window.location.origin,
                skipBrowserRedirect: true,
            }
        });
        if (!result.error && result.data?.url) {
            window.location.href = result.data.url;
        }
        return result;
    },

    signInWithGoogle: async () => {
        const result = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                skipBrowserRedirect: true,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
        if (!result.error && result.data?.url) {
            window.location.href = result.data.url;
        }
        return result;
    },

    resetPassword: async (email: string) => {
        return await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/register`
        });
    },

    // Cancel an unverified signup. Calls the SQL function which removes the
    // auth.users row only if the email is still unconfirmed. Used by the
    // 10-minute verification timeout in the registration flow.
    cancelUnverifiedSignup: async (email: string) => {
        try {
            return await supabase.rpc('cancel_unverified_signup', { target_email: email });
        } catch (e) {
            console.error('Failed to cancel unverified signup:', e);
            return { error: e } as any;
        }
    }
};
