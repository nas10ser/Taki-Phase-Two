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

/** Raw signed initData blob (empty string outside Telegram). */
export function getInitData(): string {
    const wa = getWebApp();
    return wa && typeof wa.initData === 'string' ? wa.initData : '';
}

/**
 * EXPLICIT "create a new account via Telegram" — only call this when the user
 * deliberately chose to make a brand-new Telegram account (e.g. tapped a
 * "متابعة سريعة عبر تيليجرام" button). It passes allowCreate:true, so the Edge
 * Function will create the account if none exists. NEVER call this implicitly on
 * app open — that was the forced-new-account bug (v11.71). Resolves true if
 * authenticated afterwards.
 */
export async function loginViaTelegram(): Promise<boolean> {
    const initData = getInitData();
    if (!initData) return false;
    try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess?.session) return true;
        const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { initData, allowCreate: true } });
        if (error || !data?.hashed_token) return false;
        const { error: vErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.hashed_token });
        return !vErr;
    } catch {
        return false;
    }
}

/**
 * Bind the Telegram identity (from the Mini App's signed initData) to the
 * CURRENTLY signed-in TAKI account — server-verified, so an existing
 * seller/admin account can attach Telegram to itself.
 *   'linked'            — bound to the current account
 *   'not_authenticated' — no session; caller should create/login then retry
 *   'not_telegram'      — not inside Telegram
 *   'failed'            — transient/server error
 */
export async function linkTelegramToCurrentUser(): Promise<'linked' | 'not_authenticated' | 'not_telegram' | 'failed'> {
    const initData = getInitData();
    if (!initData) return 'not_telegram';
    try {
        const { data, error } = await supabase.functions.invoke('telegram-auth', { body: { initData, mode: 'link' } });
        if (error) return 'failed';
        if (data?.success) return 'linked';
        if (data?.code === 'not_authenticated') return 'not_authenticated';
        return 'failed';
    } catch {
        return 'failed';
    }
}

/**
 * "Link my Telegram to the CURRENT account." Links only when the user is already
 * signed in — it does NOT silently create a new account anymore (v11.71). If
 * nobody is signed in it returns 'not_authenticated' so the caller can send the
 * user to the sign-in / create-account choice screen instead of forcing a new
 * Telegram account on them. Used by the profile auto-link (?tglink=1) and the
 * link button.
 */
export async function ensureTelegramLinked(): Promise<'linked' | 'not_authenticated' | 'failed' | 'not_telegram'> {
    if (!isTelegramMiniApp()) return 'not_telegram';
    const r = await linkTelegramToCurrentUser();
    if (r === 'linked') return 'linked';
    if (r === 'not_authenticated') return 'not_authenticated';
    return 'failed';
}
