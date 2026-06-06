import { supabase } from './supabaseClient';

/**
 * Telegram Mini App auto-login (v11.53).
 *
 * When TAKI is opened *inside* Telegram (via a `web_app` button), Telegram
 * injects `window.Telegram.WebApp` with a cryptographically-signed `initData`
 * blob. We hand that blob to the `telegram-auth` Edge Function, which verifies
 * the signature server-side (HMAC with the bot's key — impossible to forge) and
 * returns a one-time magiclink `hashed_token`. We exchange it via
 * `auth.verifyOtp` for a real Supabase session — so the user is logged in
 * inside Telegram with no link, no password, no typing. Outside Telegram this
 * is a complete no-op (normal web login is untouched).
 */

interface TgWebApp {
    initData?: string;
    ready?: () => void;
    expand?: () => void;
    colorScheme?: string;
}

function getWebApp(): TgWebApp | null {
    try { return (window as any)?.Telegram?.WebApp || null; } catch { return null; }
}

/** True only when running inside Telegram with a real signed initData payload. */
export function isTelegramMiniApp(): boolean {
    const wa = getWebApp();
    return !!(wa && typeof wa.initData === 'string' && wa.initData.length > 0);
}

let attempted = false;

/**
 * Idempotent. Resolves to true if the user ends up authenticated via Telegram.
 * Never throws — telemetry/login must never block app startup.
 */
export async function initTelegramMiniApp(): Promise<boolean> {
    const wa = getWebApp();
    if (!wa) return false;
    // Tell Telegram we're ready + use the full height sheet.
    try { wa.ready?.(); } catch { /* ignore */ }
    try { wa.expand?.(); } catch { /* ignore */ }

    const initData = wa.initData || '';
    if (!initData) return false;
    if (attempted) return true;
    attempted = true;

    // Already signed in on this device? Don't mint a new session.
    try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) return true;
    } catch { /* fall through to login */ }

    try {
        const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { initData } });
        if (error || !data?.hashed_token) {
            console.warn('[telegram-auth] failed', error || data);
            return false;
        }
        const { error: vErr } = await supabase.auth.verifyOtp({
            type: 'magiclink',
            token_hash: data.hashed_token,
        });
        if (vErr) { console.warn('[telegram verifyOtp] failed', vErr.message); return false; }
        return true;
    } catch (e) {
        console.warn('[telegram login] error', (e as Error)?.message || e);
        return false;
    }
}
