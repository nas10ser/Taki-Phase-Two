import React, { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile — the bot check in front of registration.
 *
 * The site key is public by design: it only says "this widget belongs to TAKI",
 * and Cloudflare refuses it on any hostname not listed in the widget's config.
 * The half that actually proves anything is the SECRET key, which never comes
 * near the browser — it lives in the auth server (Supabase today, GoTrue on our
 * own box after the Oracle move) and is what verifies the token server-side.
 *
 * Ordering matters here: this widget goes live BEFORE the server starts
 * demanding a token. A token nobody checks is harmless; a server demanding a
 * token no page produces locks everybody out of signing up. So the client ships
 * first, the server switch flips second.
 */
const SITE_KEY = process.env.TURNSTILE_SITE_KEY || '0x4AAAAAAEHE5xdLn_Bn5wIN';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
    interface Window {
        turnstile?: {
            render: (el: HTMLElement, opts: Record<string, unknown>) => string;
            remove: (id: string) => void;
            reset: (id?: string) => void;
        };
    }
}

let scriptPromise: Promise<void> | null = null;

/** Load the Cloudflare script once per page, no matter how many widgets mount. */
const loadScript = (): Promise<void> => {
    if (window.turnstile) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SCRIPT_URL;
        s.async = true;
        s.defer = true;
        s.onload = () => resolve();
        s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed')); };
        document.head.appendChild(s);
    });
    return scriptPromise;
};

interface Props {
    /** Fires with a fresh token, or with '' when it expires and must be redone. */
    onToken: (token: string) => void;
    isRTL?: boolean;
}

const TurnstileWidget: React.FC<Props> = ({ onToken, isRTL = true }) => {
    const holder = useRef<HTMLDivElement | null>(null);
    const widgetId = useRef<string | null>(null);
    // Keep the latest callback without re-rendering the widget on every parent
    // render — re-rendering it would wipe a token the user already solved for.
    const cb = useRef(onToken);
    cb.current = onToken;

    useEffect(() => {
        let cancelled = false;

        loadScript()
            .then(() => {
                if (cancelled || !holder.current || !window.turnstile) return;
                widgetId.current = window.turnstile.render(holder.current, {
                    sitekey: SITE_KEY,
                    language: isRTL ? 'ar' : 'en',
                    callback: (token: string) => cb.current(token),
                    'expired-callback': () => cb.current(''),
                    'error-callback': () => cb.current(''),
                });
            })
            .catch(() => {
                // Cloudflare unreachable (offline, blocked). Stay silent and let
                // the auth server be the judge — it is the only side that counts.
                if (!cancelled) cb.current('');
            });

        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) {
                try { window.turnstile.remove(widgetId.current); } catch { /* already gone */ }
                widgetId.current = null;
            }
        };
        // Mount once. isRTL only picks the widget's language at creation time.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={holder} className="flex justify-center my-3" />;
};

export default TurnstileWidget;
