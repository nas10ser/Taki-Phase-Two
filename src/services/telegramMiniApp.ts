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

/**
 * Is this document *plausibly* running inside Telegram — decided WITHOUT the
 * SDK, synchronously, from the URL and sessionStorage alone?
 *
 * 🔴 Why this exists (v15.66): the SDK used to be a BLOCKING `<script>` in
 *    `<head>`, fetched from telegram.org by **every visitor on every page**.
 *    Measured cost on a throttled mid-range phone: 54 ms of main thread on
 *    /deals and **302 ms on /nearby** (its `onWindowResize` alone was 270 ms),
 *    plus a third-party DNS + TLS + download before the app could render —
 *    all of it paid by the >99% of visitors who never open TAKI in Telegram.
 *
 * 🪤 Telegram hands the Mini App its payload in the URL **fragment**
 *    (`#tgWebAppData=…&tgWebAppVersion=…`). The SDK then consumes the hash and
 *    mirrors it into `sessionStorage.__telegram__initParams`, so after the
 *    first navigation the hash is gone and only the storage key remains —
 *    checking the hash alone would break auto-login on any in-app reload.
 *    The UA check is a last resort (Android's Telegram WebView says so; iOS
 *    does not), and it only ever causes the SDK to load, never a login.
 */
export function looksLikeTelegram(): boolean {
    try {
        if ((window as any)?.Telegram?.WebApp) return true;
        const u = window.location.hash + window.location.search;
        if (u.includes('tgWebApp')) return true;
        if (sessionStorage.getItem('__telegram__initParams')) return true;
        return /Telegram/i.test(navigator.userAgent || '');
    } catch { return false; }
}

const TG_SDK = 'https://telegram.org/js/telegram-web-app.js';
let sdkPromise: Promise<boolean> | null = null;

/**
 * Load the Telegram SDK on demand. Idempotent, never throws, and resolves
 * `false` on any failure so startup is never blocked.
 *
 * 🪤 A `<script>` that 404s or is blocked fires `onerror`, but one that is
 *    merely *slow* fires nothing — so the race in `index.tsx` keeps its own
 *    safety timeout; this timeout only stops the promise leaking forever.
 */
export function ensureTelegramSdk(): Promise<boolean> {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise<boolean>((resolve) => {
        try {
            if ((window as any)?.Telegram?.WebApp) { resolve(true); return; }
            const el = document.createElement('script');
            el.src = TG_SDK;
            el.async = true;
            const done = (ok: boolean) => resolve(ok && !!(window as any)?.Telegram?.WebApp);
            el.onload = () => done(true);
            el.onerror = () => done(false);
            setTimeout(() => done(false), 3500);
            document.head.appendChild(el);
        } catch { resolve(false); }
    });
    return sdkPromise;
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
    await ensureTelegramSdk();
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
    await ensureTelegramSdk();
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
    await ensureTelegramSdk();
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
    if (!looksLikeTelegram()) return 'not_telegram';
    await ensureTelegramSdk();
    if (!isTelegramMiniApp()) return 'not_telegram';
    const r = await linkTelegramToCurrentUser();
    if (r === 'linked') return 'linked';
    if (r === 'not_authenticated') return 'not_authenticated';
    return 'failed';
}
