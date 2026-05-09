/**
 * SW + Cache cleanup — fixes the "I refreshed and nothing changed" bug.
 *
 * Why this exists: an earlier sw.js (v9.x) used cache-first for navigations,
 * so phones with that SW kept serving the OLD index.html (and therefore old
 * JS hashes) even after a deploy. Users were frozen on stale builds.
 *
 * What this does on every page load:
 *   1. Listens for the new sw.js (v10+) `TAKI_SW_UPDATED` postMessage so the
 *      page auto-reloads once the new SW activates and purges old caches.
 *   2. Unregisters every active service worker (defensive — only matters on
 *      v9.x devices that haven't upgraded their SW yet).
 *   3. Deletes every CacheStorage entry left behind by v9.x.
 *   4. If anything was actually purged AND we haven't reloaded yet this
 *      session, force ONE reload so the next paint comes from the network,
 *      not the now-empty cache.
 *
 * The session sentinel prevents infinite reload loops.
 */

const RELOAD_SENTINEL = 'TAKI_SW_CLEANED_v10';

(async () => {
    if (typeof window === 'undefined') return;

    // 1) Listen for "the new SW just activated" → reload once
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event?.data?.type === 'TAKI_SW_UPDATED') {
                // Throttle: only reload once per session
                if (sessionStorage.getItem(RELOAD_SENTINEL)) return;
                try { sessionStorage.setItem(RELOAD_SENTINEL, '1'); } catch { /* private mode */ }
                window.location.reload();
            }
        });
    }

    let purgedSomething = false;

    // 2) Defensive cleanup of v9.x SWs
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                // If the SW script URL points at our own /sw.js, leave it alone
                // (the new v10+ SW handles its own update flow).
                const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
                const isOurNewSW = scriptUrl.endsWith('/sw.js') || /\/sw\.[a-f0-9]+\.js$/.test(scriptUrl);
                if (!isOurNewSW) {
                    await reg.unregister().catch(() => {});
                    purgedSomething = true;
                }
            }
        } catch { /* ignore */ }
    }

    // 3) Wipe any v9.x CacheStorage entries (the new SW will rebuild its own).
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            const stale = keys.filter((k) => !k.includes('v10'));
            if (stale.length > 0) {
                purgedSomething = true;
                await Promise.all(stale.map((k) => caches.delete(k).catch(() => false)));
            }
        } catch { /* ignore */ }
    }

    // 4) One-shot reload so the freshly-empty browser fetches the new build
    if (purgedSomething && !sessionStorage.getItem(RELOAD_SENTINEL)) {
        try { sessionStorage.setItem(RELOAD_SENTINEL, '1'); } catch { /* private mode */ }
        window.location.replace(window.location.href);
    }
})();
