// Web Push subscription helper. Best-effort; never throws into callers.
// The actual delivery happens server-side via the
// `tr_notification_push` trigger calling a Supabase Edge Function.
//
// Required env: VITE_VAPID_PUBLIC_KEY (or set window.__TAKI_VAPID_PUB__).
// If unset, the helper is a no-op and existing realtime + native
// Notification API still cover in-tab alerts.

import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';

const VAPID_PUBLIC_KEY: string =
    (typeof process !== 'undefined' && (process as any).env?.VITE_VAPID_PUBLIC_KEY)
    || (typeof window !== 'undefined' && (window as any).__TAKI_VAPID_PUB__)
    || '';

const urlBase64ToUint8Array = (b64: string): Uint8Array => {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
};

const arrayBufferToBase64 = (buf: ArrayBuffer | null): string => {
    if (!buf) return '';
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
};

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) return reg;
        // Required by Parcel to correctly bundle the Service Worker
        return await navigator.serviceWorker.register(
            new URL('../../sw.js', import.meta.url),
            { type: 'module' }
        );
    } catch (e) {
        logger.warn('SW registration failed:', (e as any)?.message || e);
        return null;
    }
}

export const pushService = {
    /**
     * Ask for permission, create or refresh a Web Push subscription,
     * and store it in `push_subscriptions`. Idempotent: re-running
     * with the same endpoint just bumps `last_used_at`.
     *
     * Pass the user id when called right after a sign-in event so we
     * don't race the auth.uid() round-trip; otherwise it falls back
     * to whatever supabase.auth currently sees.
     */
    ensurePermissionAndSubscribe: async (userId?: string): Promise<void> => {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;

        let perm = Notification.permission;
        if (perm === 'default') {
            try { perm = await Notification.requestPermission(); } catch { return; }
        }
        if (perm !== 'granted') return;

        if (!('PushManager' in window) || !VAPID_PUBLIC_KEY) {
            // No VAPID key configured → in-tab notifications only.
            return;
        }

        const reg = await getRegistration();
        if (!reg) return;

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            try {
                sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as BufferSource
                });
            } catch (e) {
                logger.warn('Push subscribe failed:', (e as any)?.message || e);
                return;
            }
        }
        if (!sub) return;

        const json = sub.toJSON?.() as any;
        const endpoint = json?.endpoint || (sub as any).endpoint;
        const p256dh = json?.keys?.p256dh || arrayBufferToBase64(sub.getKey?.('p256dh') || null);
        const auth = json?.keys?.auth || arrayBufferToBase64(sub.getKey?.('auth') || null);
        if (!endpoint || !p256dh || !auth) return;

        let uid = userId;
        if (!uid) {
            try {
                const { data } = await supabase.auth.getUser();
                uid = data?.user?.id;
            } catch {}
        }
        if (!uid) return;

        try {
            await supabase.from('push_subscriptions').upsert({
                user_id: uid,
                endpoint,
                p256dh,
                auth,
                user_agent: navigator.userAgent.slice(0, 240),
                last_used_at: new Date().toISOString()
            }, { onConflict: 'endpoint' });
        } catch (e) {
            logger.warn('Push subscription upsert failed:', (e as any)?.message || e);
        }
    },

    /**
     * Remove the current device's subscription. Called on logout so a
     * shared device doesn't keep pinging the previous account.
     */
    unsubscribe: async (): Promise<void> => {
        try {
            const reg = await getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (!sub) return;
            const endpoint = sub.endpoint;
            await sub.unsubscribe().catch(() => {});
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        } catch {}
    }
};
