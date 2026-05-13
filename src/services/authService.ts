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
    preferredLang?: 'ar' | 'en';
    lat?: number;
    lng?: number;
    googleMapsLink?: string;
}

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

    signUpWithEmail: async (email: string, password: string, userData: { name: string, phone: string, user_type: string, shop?: string | null, contact_phone?: string, address?: string }) => {
        return await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    name: userData.name,
                    phone: userData.phone,
                    user_type: userData.user_type,
                    shop: userData.shop || null,
                    contact_phone: userData.contact_phone || userData.phone,
                    address: userData.address || '',
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
        // Only consult the public users table. The previous fallback used
        // supabase.auth.signUp() which CREATES a real auth user with a random
        // password whenever the email didn't already exist — corrupting future
        // logins. Confirmed users are always written to public.users via the
        // onAuthStateChange handler, so this single check is authoritative.
        try {
            const { data, error } = await supabase.from('users').select('id').ilike('email', email).maybeSingle();
            if (!error && data) return true;
        } catch {}
        return false;
    },

    /**
     * Combined check: returns which fields are already taken
     * Used for real-time inline validation during registration
     */
    checkFieldsAvailability: async (email?: string, phone?: string): Promise<{ emailTaken: boolean; phoneTaken: boolean }> => {
        let emailTaken = false;
        let phoneTaken = false;

        try {
            if (email) {
                const { data } = await supabase.from('users').select('id').ilike('email', email).maybeSingle();
                emailTaken = !!data;
            }
            if (phone) {
                const { data } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
                phoneTaken = !!data;
            }
        } catch {
            // Silently fail - don't block UX
        }

        return { emailTaken, phoneTaken };
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
                            resolve({ error: { message: 'لم يتم العثور على حساب بهذا الرقم. تأكد من الرقم أو سجّل حساباً جديداً' } });
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

    signInWithApple: async () => {
        return await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: window.location.origin
            }
        });
    },

    signInWithGoogle: async () => {
        return await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
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
