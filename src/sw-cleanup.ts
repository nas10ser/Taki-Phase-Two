/**
 * SW + Cache cleanup + in-app update detection.
 *
 * Previous version did an auto window.location.reload() the moment a new
 * service worker activated. On iOS Safari that frequently happened while
 * the user was mid-scroll / mid-form and they'd lose their place — or,
 * worse, the message never arrived (Safari pauses SW chatter in the
 * background) and the user had to force-quit Safari to see new code.
 *
 * v10.25 rewires this to a user-facing pattern:
 *   1. On load, register the SW and start a periodic update probe
 *      (every 60s while the tab is foregrounded).
 *   2. When a new SW reaches `waiting` state, dispatch a custom DOM
 *      event `taki:sw-update-available`. The UpdateBanner component
 *      listens for that event and shows a single-tap refresh button.
 *   3. When the user taps the button, we postMessage SKIP_WAITING to
 *      the waiting worker. The browser fires `controllerchange`, which
 *      we use as the canonical "the new worker is in charge" signal,
 *      and only THEN do we reload — once.
 *
 * This means the user never leaves the app to get the latest build; a
 * banner appears, they tap "تحديث الآن", the page swaps in place. No
 * Safari restart required.
 */

const CONTROLLER_CHANGE_RELOADED = 'TAKI_SW_RELOADED_v10_25';
const UPDATE_EVENT = 'taki:sw-update-available';

function dispatchUpdateAvailable() {
    try {
        window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
    } catch {
        // Older browsers — CustomEvent constructor missing. Fall back to
        // legacy Event so the banner still hears about it.
        const ev = document.createEvent('Event');
        ev.initEvent(UPDATE_EVENT, true, true);
        window.dispatchEvent(ev);
    }
}

const VERSION_KEY = 'TAKI_SW_VERSION_SEEN';
const AUTO_APPLIED_KEY = 'TAKI_SW_AUTO_APPLIED_AT';

/**
 * Compare the CACHE_NAME baked into the live /sw.js against the last one
 * we observed on this device. If the server advanced (new deploy) and we
 * haven't auto-applied within the last 60 seconds, just nuke the cache
 * and reload — no banner, no waiting on iOS Safari's lazy SW-update
 * scheduling. This is the path that makes "I deployed but the user is
 * still on the old version" stop happening.
 */
let _lastVersionCheck = 0;

async function autoCheckServerVersion(): Promise<void> {
    // Throttle: foreground events (visibilitychange/pageshow/focus) can
    // fire in bursts on iOS — one network probe per 15s is plenty.
    if (Date.now() - _lastVersionCheck < 15_000) return;
    _lastVersionCheck = Date.now();
    try {
        // Force a network fetch — we have to bypass the SW for THIS one
        // request, otherwise the stale SW happily returns its cached
        // copy of /sw.js and we never detect the drift.
        const res = await fetch('/sw.js?_v=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const match = /taki-cache-v[\d.]+/.exec(text);
        if (!match) return;
        const serverVersion = match[0];

        let lastSeen: string | null = null;
        try { lastSeen = localStorage.getItem(VERSION_KEY); } catch {}

        if (!lastSeen) {
            try { localStorage.setItem(VERSION_KEY, serverVersion); } catch {}
            return;
        }
        if (lastSeen === serverVersion) return;

        // Different version on the server. Throttle to one auto-apply per
        // 60 s so a momentary glitch can't loop us.
        let appliedAt = 0;
        try { appliedAt = Number(localStorage.getItem(AUTO_APPLIED_KEY) || '0'); } catch {}
        if (Date.now() - appliedAt < 60_000) return;

        try {
            localStorage.setItem(VERSION_KEY, serverVersion);
            localStorage.setItem(AUTO_APPLIED_KEY, String(Date.now()));
        } catch {}

        // Apply without any UI — by the time the user notices the page
        // already came back with the new build. The banner stays as a
        // fallback path for cases where this fetch fails.
        applySwUpdate();
    } catch { /* offline / blocked — leave it; the banner will catch up */ }
}

(async () => {
    if (typeof window === 'undefined') return;

    // Kick the version probe immediately. It runs in parallel with the
    // rest of the SW wiring below.
    autoCheckServerVersion();

    // CRITICAL for iOS standalone PWAs: when the user "reopens" the app
    // iOS resumes it from memory/bfcache WITHOUT re-running this module
    // or doing a fresh navigation — so the cold-start probe above never
    // fires again and the device stays frozen on an old build no matter
    // how many times they reopen. Re-checking the server's sw.js version
    // every time the app returns to the foreground is what actually
    // delivers new deploys to iOS PWA users (throttled to 1/15s inside).
    const onForeground = () => {
        if (document.visibilityState !== 'hidden') autoCheckServerVersion();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('pageshow', onForeground);
    window.addEventListener('focus', onForeground);

    if ('serviceWorker' in navigator) {
        // Reload exactly once when the new worker takes control. This is the
        // canonical hook — fires after SKIP_WAITING resolves.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (sessionStorage.getItem(CONTROLLER_CHANGE_RELOADED)) return;
            try { sessionStorage.setItem(CONTROLLER_CHANGE_RELOADED, '1'); } catch { /* private mode */ }
            window.location.reload();
        });

        // The v10+ SW also posts TAKI_SW_UPDATED on its `activate` handler.
        // Treat it as an additional signal that an update is ready — useful
        // when the page never sees `waiting` (e.g. first install, or a
        // background tab where the new SW skipped straight to active).
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event?.data?.type === 'TAKI_SW_UPDATED') {
                dispatchUpdateAvailable();
            }
        });

        // Try to attach to whatever SW is currently registered for /. If a
        // new SW is already waiting (e.g. user kept the tab open across two
        // deploys), surface the banner immediately.
        try {
            const reg = await navigator.serviceWorker.getRegistration('/');
            if (reg) {
                // Immediate update probe on mount — iOS Safari otherwise
                // waits up to 24 h before checking sw.js on its own. This
                // is a no-op if the worker is already current.
                reg.update().catch(() => {});

                if (reg.waiting) {
                    dispatchUpdateAvailable();
                }
                reg.addEventListener('updatefound', () => {
                    const installing = reg.installing;
                    if (!installing) return;
                    installing.addEventListener('statechange', () => {
                        // installed + an active controller already exists =
                        // we just got a NEW worker for an existing site.
                        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                            dispatchUpdateAvailable();
                        }
                    });
                });

                // Foreground polling: every 60s while visible, ask the SW
                // host for a fresh sw.js. iOS Safari sometimes delays this
                // check on its own; nudging keeps the banner timely.
                const probe = () => {
                    if (document.visibilityState === 'visible') {
                        reg.update().catch(() => {});
                    }
                };
                setInterval(probe, 60_000);
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') probe();
                });
            }
        } catch { /* registration query failed — that's fine, banner just won't appear */ }

        // Defensive: unregister legacy non-/sw.js workers (pre-v10).
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const r of regs) {
                const scriptUrl = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '';
                const isOurNewSW = scriptUrl.endsWith('/sw.js') || /\/sw\.[a-f0-9]+\.js$/.test(scriptUrl);
                if (!isOurNewSW) {
                    await r.unregister().catch(() => {});
                }
            }
        } catch { /* ignore */ }
    }

    // Wipe ancient CacheStorage entries (pre-v10). The new SW manages its
    // own cache namespace; anything outside it is dead weight.
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            const stale = keys.filter((k) => !k.includes('v10'));
            if (stale.length > 0) {
                await Promise.all(stale.map((k) => caches.delete(k).catch(() => false)));
            }
        } catch { /* ignore */ }
    }
})();

/**
 * Aggressive in-app update. Previous version posted SKIP_WAITING and
 * relied on `controllerchange` to fire the reload. On iOS Safari that
 * sometimes never arrives in a reasonable window — the user reported
 * "the update hangs and I have to leave the app". So this version:
 *
 *   1. Nudge the waiting SW to take over (best-effort).
 *   2. Wipe every CacheStorage entry so the next request has to hit
 *      the network. That alone guarantees fresh JS/CSS even if the SW
 *      handoff lags.
 *   3. Hard-reload the page immediately. Don't wait for any handshake.
 *
 * The controllerchange listener in this file still fires on cold-load
 * paths (e.g. first install of a new SW); we just no longer block the
 * UI on it.
 */
export async function applySwUpdate(): Promise<void> {
    try {
        if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.getRegistration('/');
            if (reg?.waiting) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }
    } catch { /* ignore — we'll still purge + reload below */ }

    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k).catch(() => false)));
        } catch { /* ignore */ }
    }

    // Bypass the bfcache so the next paint actually hits the network.
    // Some iOS Safari versions still serve from cache on reload() — using
    // location.replace with a cache-busted URL is the strongest signal.
    try {
        const u = new URL(window.location.href);
        u.searchParams.set('_taki_r', String(Date.now()));
        window.location.replace(u.toString());
    } catch {
        window.location.reload();
    }
}
