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

(async () => {
    if (typeof window === 'undefined') return;

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
 * Called by the UpdateBanner when the user taps "Update now". Posts the
 * SKIP_WAITING message to whichever worker is in `waiting` state; the
 * SW will then activate, the browser will fire `controllerchange`, and
 * our listener above will reload the page exactly once.
 *
 * Falls back to a plain reload if no waiting worker exists (e.g. the
 * UPDATE_EVENT fired from a TAKI_SW_UPDATED message but no `waiting`
 * has materialised) — that still gets the user onto fresh code.
 */
export async function applySwUpdate(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        window.location.reload();
        return;
    }
    try {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg?.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            // controllerchange listener handles the reload.
            return;
        }
    } catch { /* fall through */ }
    // No waiting worker — reload directly. The current SW will fetch the
    // new sw.js on next navigation.
    window.location.reload();
}
